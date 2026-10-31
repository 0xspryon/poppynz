/**
 * Staging UAT — the admin billing fast-forward (docs/staging-uat.md). An
 * admin runs ONE contract's billing "as of" a later instant, chosen from the
 * contract's upcoming billing events, to watch hold → capture → transfer
 * (or a decline, a refund, an extra session…) without waiting days.
 *
 * It runs `runBillingTickSteps` scoped to that contract with `now` replaced
 * — exactly the worker's tick — so nothing else moves. Provider calls (Stripe
 * TEST mode, enforced by the switch) happen at the real time.
 *
 * Why in the API process rather than queued to the worker: every step is safe
 * late, twice or concurrently (compare-and-set writes, idempotent inserts,
 * provider idempotency keys — see engine.ts), so a fast-forward racing the
 * worker's own tick is harmless; and the API runtime already holds every
 * repo plus CycleSettlementLive and CardDisputeLedgerLive. The admin gets
 * the outcome in the same request, and `billing_clock_runs` (one running row
 * per contract, partial unique index) keeps two admins from running the same
 * contract at once. The switch lives in @repo/env (checkBillingTimeTravel).
 */
import {
  BillingClockRunRepo,
  CardDisputeRepo,
  ContractBillingRepo,
  ExtraSessionRepo,
  SessionMoneyRepo,
  SessionResolutionRepo,
  type BillingClockRun,
  type CardDispute,
  type ContractCycle,
  type ExtraSession,
  type HelperTransfer,
  type SessionResolution
} from '@repo/db';
import { Cause, Clock, Data, Effect } from 'effect';
import { cardDisputePolicy } from './card-disputes';
import { failedTickItems, runBillingTickSteps } from './tick-steps';

export type BillingClockEventKind =
  | 'cycle_hold'
  | 'cycle_hold_retry'
  | 'cycle_suspension'
  | 'cycle_capture'
  | 'cycle_capture_retry'
  | 'cycle_transfer'
  | 'transfer_due'
  | 'resolution_deadline'
  | 'day_off_cutoff'
  | 'extra_response_deadline'
  | 'extra_charge'
  | 'extra_charge_retry'
  | 'dispute_evidence_reminder';

export type BillingClockEvent = {
  kind: BillingClockEventKind;
  /** The instant the tick acts on it (comparisons include it). */
  at: Date;
  /** English, for the audit trail; the web labels it from `kind`. */
  label: string;
  /** The cycle's 1-based number, when the event belongs to a cycle. */
  cycleNumber: number | null;
  /** The cycle's first day, or the extra session's date. */
  date: string | null;
  /** The cycle's last day. */
  endDate: string | null;
  /** The row the event belongs to (cycle, transfer, resolution, …). */
  subjectId: string;
};

export type BillingClockSources = {
  cycles: ReadonlyArray<ContractCycle>;
  transfers: ReadonlyArray<HelperTransfer>;
  resolutions: ReadonlyArray<SessionResolution>;
  extras: ReadonlyArray<ExtraSession>;
  /** The contract's open disputes still needing evidence. */
  disputes: ReadonlyArray<CardDispute>;
  evidenceReminderHours: number;
};

const HOUR_MS = 3_600_000;

/**
 * Every instant at which the tick will next act on the contract, after
 * `now`, earliest first:
 *
 *   cycles     scheduled → holdAt; grace → nextRetryAt and startsAt (the
 *              suspension); authorised → captureAt; capture_failed →
 *              nextRetryAt; captured without a transfer → transferAt
 *   transfers  due → dueAt
 *   sessions   a proposed resolution → respondBy
 *   extras     proposed → respondBy; agreed → chargeAt; charge_failed →
 *              nextRetryAt
 *   disputes   evidenceDueBy minus CONTRACT_DISPUTE_EVIDENCE_REMINDER_HOURS
 */
export const billingClockEvents = (
  sources: BillingClockSources,
  now: Date
): Array<BillingClockEvent> => {
  const events: Array<BillingClockEvent> = [];
  const cycleById = new Map(sources.cycles.map((cycle) => [cycle.id, cycle]));
  const transferred = new Set(sources.transfers.map((transfer) => transfer.cycleId));
  const cycleEvent = (
    cycle: ContractCycle,
    kind: BillingClockEventKind,
    at: Date | null,
    what: string,
    subjectId: string = cycle.id
  ) => {
    if (at === null) return;
    events.push({
      kind,
      at,
      label: `Cycle ${cycle.index + 1} (${cycle.startsOn} – ${cycle.endsOn}): ${what}`,
      cycleNumber: cycle.index + 1,
      date: cycle.startsOn,
      endDate: cycle.endsOn,
      subjectId
    });
  };

  for (const cycle of sources.cycles) {
    switch (cycle.status) {
      case 'scheduled':
        cycleEvent(cycle, 'cycle_hold', cycle.holdAt, 'card hold');
        break;
      case 'grace':
        cycleEvent(cycle, 'cycle_hold_retry', cycle.nextRetryAt, 'retry the declined hold');
        cycleEvent(cycle, 'cycle_suspension', cycle.startsAt, 'suspension if still unpaid');
        break;
      case 'authorised':
        cycleEvent(cycle, 'cycle_capture', cycle.captureAt, 'capture');
        break;
      case 'capture_failed':
        cycleEvent(cycle, 'cycle_capture_retry', cycle.nextRetryAt, 'retry the capture');
        break;
      case 'captured':
        if (!transferred.has(cycle.id)) {
          cycleEvent(cycle, 'cycle_transfer', cycle.transferAt, 'transfer to the helper');
        }
        break;
      default:
        break;
    }
  }

  for (const transfer of sources.transfers) {
    if (transfer.status !== 'due') continue;
    const cycle = cycleById.get(transfer.cycleId);
    if (cycle) {
      cycleEvent(
        cycle,
        'transfer_due',
        transfer.dueAt,
        `transfer #${transfer.sequence} to the helper`,
        transfer.id
      );
    } else {
      events.push({
        kind: 'transfer_due',
        at: transfer.dueAt,
        label: `Transfer #${transfer.sequence} to the helper`,
        cycleNumber: null,
        date: null,
        endDate: null,
        subjectId: transfer.id
      });
    }
  }

  for (const resolution of sources.resolutions) {
    if (resolution.status !== 'proposed' || resolution.respondBy === null) continue;
    const dayOff = resolution.kind === 'day_off_agreed';
    events.push({
      kind: dayOff ? 'day_off_cutoff' : 'resolution_deadline',
      at: resolution.respondBy,
      label: dayOff
        ? 'Day off: unconfirmed proposal lapses'
        : 'Session report: confirmed by silence',
      cycleNumber: null,
      date: null,
      endDate: null,
      subjectId: resolution.id
    });
  }

  for (const extra of sources.extras) {
    const extraEvent = (kind: BillingClockEventKind, at: Date | null, what: string) => {
      if (at === null) return;
      events.push({
        kind,
        at,
        label: `Extra session ${extra.date}: ${what}`,
        cycleNumber: null,
        date: extra.date,
        endDate: null,
        subjectId: extra.id
      });
    };
    if (extra.status === 'proposed')
      extraEvent('extra_response_deadline', extra.respondBy, 'lapses unanswered');
    if (extra.status === 'agreed') extraEvent('extra_charge', extra.chargeAt, 'charge');
    if (extra.status === 'charge_failed') {
      extraEvent('extra_charge_retry', extra.nextRetryAt, 'retry the charge');
    }
  }

  for (const dispute of sources.disputes) {
    if (dispute.evidenceDueBy === null) continue;
    const at = new Date(dispute.evidenceDueBy.getTime() - sources.evidenceReminderHours * HOUR_MS);
    // The reminder is sent once, while the evidence is not due yet.
    if (dispute.noticesSent.includes(`reminder:${dispute.evidenceDueBy.toISOString()}`)) continue;
    events.push({
      kind: 'dispute_evidence_reminder',
      at,
      label: 'Card dispute: evidence reminder to the admins',
      cycleNumber: null,
      date: null,
      endDate: null,
      subjectId: dispute.id
    });
  }

  return events
    .filter((event) => event.at > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.label.localeCompare(b.label));
};

/** Reads what `billingClockEvents` needs for one contract. */
export const loadBillingClockEvents = (contractId: string, now: Date) =>
  Effect.gen(function* () {
    const { evidenceReminderHours } = yield* cardDisputePolicy;
    const cycles = yield* (yield* ContractBillingRepo).listCycles(contractId);
    const transfers = yield* (yield* SessionMoneyRepo).listTransfers({ contractId });
    const resolutions = yield* (yield* SessionResolutionRepo).listForContract(contractId);
    const extras = yield* (yield* ExtraSessionRepo).listForContract(contractId);
    const disputes = (yield* (yield* CardDisputeRepo).list({
      open: true,
      triage: ['needs_response']
    })).filter((dispute) => dispute.contractId === contractId);
    return billingClockEvents(
      { cycles, transfers, resolutions, extras, disputes, evidenceReminderHours },
      now
    );
  });

export type BillingClockRefusal =
  /** No billing on file for the contract. */
  | 'not_found'
  /** The instant is not after the real time. */
  | 'not_in_future'
  /** The instant is further ahead than BILLING_TIME_TRAVEL_MAX_DAYS. */
  | 'too_far'
  /** Another run of the contract is in progress. */
  | 'already_running';

export class BillingClockError extends Data.TaggedError('BillingClockError')<{
  reason: BillingClockRefusal;
}> {}

const DAY_MS = 86_400_000;
/** A run still `running` after this long was abandoned (its process died). */
export const BILLING_CLOCK_STALE_AFTER_MS = 15 * 60_000;

export type BillingClockRunInput = {
  contractId: string;
  /** The instant to run the contract's billing as of. */
  until: Date;
  actorUserId: string;
  /** The real time. */
  now: Date;
  maxDays: number;
};

/** Checks the instant against the real time and the configured horizon. */
export const validateBillingClockTarget = (until: Date, now: Date, maxDays: number) => {
  if (until.getTime() <= now.getTime()) return 'not_in_future' as const;
  if (until.getTime() - now.getTime() > maxDays * DAY_MS) return 'too_far' as const;
  return null;
};

/**
 * Runs every tick step for `contractId` as of `until`, audited in
 * `billing_clock_runs`. Refuses an instant in the past or beyond the
 * horizon, an unknown contract, and a second concurrent run of the same
 * contract. A step that fails is recorded on the run (`failed`), never
 * hidden; its effects so far stay (nothing can be undone).
 */
export const runBillingClock = (input: BillingClockRunInput) =>
  Effect.gen(function* () {
    const refusal = validateBillingClockTarget(input.until, input.now, input.maxDays);
    if (refusal) return yield* Effect.fail(new BillingClockError({ reason: refusal }));
    const billingRepo = yield* ContractBillingRepo;
    const before = yield* billingRepo.findBilling(input.contractId);
    if (!before) return yield* Effect.fail(new BillingClockError({ reason: 'not_found' }));

    const events = yield* loadBillingClockEvents(input.contractId, input.now);
    const event = events.find((row) => row.at.getTime() === input.until.getTime()) ?? null;

    const runs = yield* BillingClockRunRepo;
    const run = yield* runs.start({
      contractId: input.contractId,
      actorUserId: input.actorUserId,
      targetAt: input.until,
      eventKind: event?.kind ?? null,
      eventLabel: event?.label ?? null,
      billingStatusBefore: before.status,
      startedAt: input.now,
      staleBefore: new Date(input.now.getTime() - BILLING_CLOCK_STALE_AFTER_MS)
    });
    if (!run) return yield* Effect.fail(new BillingClockError({ reason: 'already_running' }));

    yield* Effect.logInfo(
      `[billing-clock] ${input.actorUserId} runs contract ${input.contractId} as of ${input.until.toISOString()}`
    );
    const exit = yield* runBillingTickSteps(input.until, { contractId: input.contractId }).pipe(
      Effect.exit
    );
    const after = yield* billingRepo
      .findBilling(input.contractId)
      .pipe(Effect.orElseSucceed(() => null));
    const failed = exit._tag === 'Success' ? failedTickItems(exit.value) : null;
    const finishedAt = new Date(yield* Clock.currentTimeMillis);
    const finished = yield* runs.finish(run.id, {
      status: exit._tag === 'Failure' || (failed ?? 0) > 0 ? 'failed' : 'succeeded',
      billingStatusAfter: after?.status ?? null,
      summary: exit._tag === 'Success' ? (exit.value as unknown as Record<string, unknown>) : null,
      error:
        exit._tag === 'Failure'
          ? Cause.pretty(exit.cause).slice(0, 2000)
          : failed
            ? `${failed} item(s) failed — see the api logs`
            : null,
      finishedAt
    });
    return (finished ?? run) satisfies BillingClockRun;
  });
