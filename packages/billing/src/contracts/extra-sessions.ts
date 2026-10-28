import { addDays, instantAt, sessionElapsedMinutes, todayIn } from '@repo/calendar';
import {
  BillingCustomerRepo,
  ContractBillingRepo,
  ContractRepo,
  ExtraSessionRepo,
  PaymentRepo,
  SessionMoneyRepo,
  liveBillingStatuses,
  unpaidExtraSessionStatuses,
  type BillingLedgerInsert,
  type Contract,
  type ContractBilling,
  type ContractCycle,
  type ContractVersion,
  type DBNotFoundError,
  type ExtraSession,
  type ExtraSessionAudit,
  type Payment,
  type SessionChargeInsert,
  type SessionRecord
} from '@repo/db';
import { extraSessionConfig } from '@repo/env';
import type { SqlError } from '@effect/sql/SqlError';
import {
  Payments,
  type ChargeSavedCardInput,
  type PaymentProviderError,
  type ProviderPayment
} from '@repo/payments';
import { Context, Data, Effect, Either, Layer } from 'effect';
import { toCard } from '../cards';
import {
  applyBps,
  MINIMUM_CHARGE_CENTS,
  quoteContractAmounts,
  sessionValueCents,
  type ContractAmounts,
  type ProvinceCode,
  type TaxLine
} from '../pricing';
import { CycleSettlement, mismatchReason } from '../settle';
import { loadTaxSnapshot } from '../tax';
import {
  adoptProviderPayment,
  contractBillingPolicy,
  quoteCycleSessions,
  settleCycleRow,
  type BillingDeps,
  type CycleSettleOutcome
} from './engine';
import { sendExtraSessionNotice, type ExtraSessionEvent } from './extra-session-notices';
import { cyclePayables, ensureFollowUpTransfer } from './money';
import { alertAdmins, cycleDates, personName } from './notices';
import { sessionResolutionPolicy, windowLastDate, type PartySide } from './resolutions';
import { effectiveEnd } from './terms';

/**
 * Extra sessions (Tier 3 step 3, spec 2026-10-28 §1 step 3, §12 decisions 4
 * and 5). Either side of a running contract proposes a session outside the
 * weekly pattern — a date, a start and end time in the contract zone, one of
 * the contract's services at its agreed rate — dated from
 * `CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS` back (a session that took place) up
 * to the end of the materialisation window.
 *
 * Confirmation is explicit, never silence: the family always ticks "I
 * authorise Poppynz to charge my card $X" — with its own proposal, or when
 * confirming the helper's — and an unanswered proposal lapses after
 * `CONTRACT_REPORT_RESPONSE_HOURS`. Once both agreed it becomes a dated
 * session (origin `extra`, charge route `pending`); its charge waits
 * `CONTRACT_EXTRA_SESSION_CHARGE_DELAY_MINUTES`, during which either side may
 * cancel it at no cost. Then, by its cycle's state:
 *
 *   | cycle                         | charge                                  |
 *   | not held yet (or in grace)    | folded into the cycle's charge          |
 *   | held, the requote still fits  | folded: the capture is re-quoted        |
 *   | held and it no longer fits    | its own off-session charge              |
 *   | captured, past, nothing to bill| its own off-session charge             |
 *   | hold or capture in flight     | waits for the next tick                 |
 *
 * Its own charge is priced exactly like a cycle (the contract's frozen fee
 * and commission, the current tax configuration for its date) and frozen on
 * its own payment row (`contract_extra_session`), under the idempotency key
 * `extra-<id>-<attempt>`, and settles through the one settle path. Its
 * per-session split is the session itself. A decline never suspends the
 * contract: the family is told to update the card, the charge is retried
 * every `CONTRACT_BILLING_RETRY_HOURS` and whenever the card is replaced, and
 * an admin incident is raised once it is unpaid for
 * `CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS`. The helper is paid for it only
 * once its charge succeeded: its frozen charge row is what the transfers
 * read (the cycle's transfer, or a follow-up when that went out already).
 *
 * After that it is a normal session: cancellations, reports, disputes,
 * refunds (on its own payment) and recoveries apply unchanged.
 */

export type ExtraSessionDeps = BillingDeps | ExtraSessionRepo | SessionMoneyRepo;

type ExtraError = SqlError | DBNotFoundError | PaymentProviderError;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The provider remembers an idempotency key for 24 h: within this window
 * an unanswered attempt is replayed (never a second charge). */
const REPLAY_WINDOW_MS = 23 * HOUR_MS;
/** A search miss is "nothing exists" only once the attempt is this old. */
const SEARCH_SETTLED_MS = HOUR_MS;
/** An unanswered attempt is looked up once it is older than this. */
const LOOKUP_AFTER_MS = 2 * MINUTE_MS;
const UNANSWERED = 'payment provider unavailable';

// ---------------------------------------------------------------------------
// Settings and rules

export type ExtraSessionPolicy = {
  lookbackDays: number;
  chargeDelayMinutes: number;
  unpaidAlertDays: number;
  maxChargeAttempts: number;
  minMinutes: number;
  /** CONTRACT_REPORT_RESPONSE_HOURS: unanswered proposals lapse after it. */
  responseHours: number;
  /** CONTRACT_SESSION_WINDOW_DAYS. */
  windowDays: number;
  /** CONTRACT_BILLING_RETRY_HOURS: a declined charge is retried this often. */
  retryHours: number;
};

/** The settings, read once per call. Malformed values fail loudly. */
export const extraSessionPolicy = Effect.all([
  extraSessionConfig.pipe(
    Effect.tapError((error) =>
      Effect.logError('[extra-sessions] extra session settings are invalid', error)
    ),
    Effect.orDie
  ),
  sessionResolutionPolicy,
  contractBillingPolicy
]).pipe(
  Effect.map(
    ([extra, resolution, billing]): ExtraSessionPolicy => ({
      ...extra,
      responseHours: resolution.reportResponseHours,
      windowDays: billing.sessionWindowDays,
      retryHours: billing.retryHours
    })
  )
);

/** Why a proposal, an answer or a cancellation is refused (each is its own
 * API error code and toast). */
export type ExtraSessionRefusal =
  /** The contract isn't running (only active or ending contracts). */
  | 'contract_not_active'
  /** Its billing isn't running normally (awaiting the helper's payouts,
   * suspended, ended). */
  | 'billing_unavailable'
  /** Not one of the contract's services. */
  | 'unknown_service'
  /** Not a valid time range within one day (or shorter than the minimum). */
  | 'invalid_times'
  /** Dated before the lookback (`CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS`). */
  | 'too_far_back'
  /** Dated after the materialisation window. */
  | 'beyond_window'
  /** Outside the contract's start and end. */
  | 'outside_contract'
  /** No billing cycle covers the date (yet). */
  | 'no_cycle'
  /** Overlaps another session of the contract or an open proposal. */
  | 'overlap'
  /** The family must tick "I authorise Poppynz to charge my card $X". */
  | 'authorisation_required'
  /** The authorised amount isn't what it costs now: shown again. */
  | 'amount_changed'
  /** It can't be priced (tax configuration) or is under the minimum charge. */
  | 'not_priced'
  /** The other side's to do (answering your own proposal, withdrawing the
   * other side's). */
  | 'wrong_side'
  /** Nothing is waiting for an answer. */
  | 'nothing_to_answer'
  /** The time to answer has passed (it lapsed). */
  | 'response_window_closed'
  /** Only your own proposal, before it is answered, can be withdrawn. */
  | 'not_withdrawable'
  /** Only an agreed extra session, before its charge, can be cancelled. */
  | 'not_cancellable';

export class ExtraSessionRefusedError extends Data.TaggedError('ExtraSessionRefusedError')<{
  reason: ExtraSessionRefusal;
}> {}

/** Unknown extra session, or not this contract's. */
export class ExtraSessionNotFoundError extends Data.TaggedError('ExtraSessionNotFoundError')<{}> {}

const refuse = (reason: ExtraSessionRefusal) =>
  Effect.fail(new ExtraSessionRefusedError({ reason }));

/** A compare-and-set to a status that holds no slot: the overlap guard
 * never fires for it. */
const advanceExtra = (
  ...args: Parameters<Context.Tag.Service<typeof ExtraSessionRepo>['advance']>
) =>
  ExtraSessionRepo.pipe(
    Effect.flatMap((repo) => repo.advance(...args)),
    Effect.catchTag('ExtraSessionOverlapError', () => Effect.succeed(null))
  );

export type ExtraSessionSlot = {
  date: string;
  startMinutes: number;
  endMinutes: number;
  serviceId: string;
};

/** What a slot check reads about the contract. */
export type ExtraSessionContext = {
  contract: Contract;
  billing: ContractBilling;
  accepted: ContractVersion;
  zone: string;
  endsOn: string | null;
  endsAtMinutes: number | null;
  sessions: ReadonlyArray<SessionRecord>;
  cycles: ReadonlyArray<ContractCycle>;
  extras: ReadonlyArray<ExtraSession>;
};

/** The dates an extra session may be proposed for now (inclusive), or null
 * when there are none. */
export const allowedExtraSessionDates = (
  ctx: Pick<ExtraSessionContext, 'billing' | 'zone' | 'endsOn'>,
  now: Date,
  policy: Pick<ExtraSessionPolicy, 'lookbackDays' | 'windowDays'>
) => {
  const today = todayIn(ctx.zone, now);
  const back = addDays(today, -policy.lookbackDays);
  const first = back < ctx.billing.startsOn ? ctx.billing.startsOn : back;
  let last = windowLastDate(ctx.zone, now, policy.windowDays);
  const materialised = ctx.billing.materialisedThrough;
  if (materialised !== null && materialised < last) last = materialised;
  if (ctx.endsOn !== null && ctx.endsOn < last) last = ctx.endsOn;
  return first <= last ? { first, last } : null;
};

/** The instants of a slot in the contract zone. */
export const slotInstants = (slot: Omit<ExtraSessionSlot, 'serviceId'>, zone: string) => ({
  startsAt: instantAt(slot.date, slot.startMinutes, zone),
  endsAt: instantAt(slot.date, slot.endMinutes, zone)
});

/** The cycle billing a date (cycles cover consecutive days). */
export const cycleCovering = (cycles: ReadonlyArray<ContractCycle>, date: string) =>
  cycles.find((cycle) => cycle.startsOn <= date && date <= cycle.endsOn) ?? null;

/**
 * Null when the slot may be proposed (or, `answering`, agreed) now, else why
 * not. Answering skips the lookback and window: they bound when a proposal
 * is made, and an answer within the response window stands.
 */
export const checkExtraSessionSlot = (
  slot: ExtraSessionSlot,
  ctx: ExtraSessionContext,
  now: Date,
  policy: ExtraSessionPolicy,
  options: { answering?: ExtraSession } = {}
): ExtraSessionRefusal | null => {
  const today = todayIn(ctx.zone, now);
  if (ctx.contract.status !== 'active' && ctx.contract.status !== 'ending') {
    return 'contract_not_active';
  }
  if (ctx.endsOn !== null && ctx.endsOn < today) return 'contract_not_active';
  if (ctx.billing.status !== 'scheduled' && ctx.billing.status !== 'active') {
    return 'billing_unavailable';
  }
  if (!ctx.accepted.services.some((service) => service.serviceId === slot.serviceId)) {
    return 'unknown_service';
  }
  if (
    !Number.isInteger(slot.startMinutes) ||
    !Number.isInteger(slot.endMinutes) ||
    slot.startMinutes < 0 ||
    slot.endMinutes > 24 * 60 ||
    slot.endMinutes - slot.startMinutes < policy.minMinutes ||
    !/^\d{4}-\d{2}-\d{2}$/.test(slot.date)
  ) {
    return 'invalid_times';
  }
  if (
    slot.date < ctx.billing.startsOn ||
    (ctx.endsOn !== null && slot.date > ctx.endsOn) ||
    (ctx.endsOn !== null &&
      slot.date === ctx.endsOn &&
      ctx.endsAtMinutes !== null &&
      slot.endMinutes > ctx.endsAtMinutes)
  ) {
    return 'outside_contract';
  }
  if (!options.answering) {
    if (slot.date < addDays(today, -policy.lookbackDays)) return 'too_far_back';
    const range = allowedExtraSessionDates(ctx, now, policy);
    if (range === null || slot.date > range.last) return 'beyond_window';
  }
  if (cycleCovering(ctx.cycles, slot.date) === null) return 'no_cycle';
  const { startsAt, endsAt } = slotInstants(slot, ctx.zone);
  const overlaps = (from: Date, to: Date) => from < endsAt && startsAt < to;
  const ownSession = options.answering?.sessionId ?? null;
  if (
    ctx.sessions.some(
      (session) =>
        session.status !== 'cancelled' &&
        session.id !== ownSession &&
        overlaps(session.startsAt, session.endsAt)
    ) ||
    ctx.extras.some(
      (extra) =>
        extra.status === 'proposed' &&
        extra.id !== options.answering?.id &&
        overlaps(extra.startsAt, extra.endsAt)
    )
  ) {
    return 'overlap';
  }
  return null;
};

/** Null when `side` may answer `extra` now. */
export const checkExtraSessionAnswer = (
  extra: Pick<ExtraSession, 'status' | 'proposedBySide' | 'respondBy'>,
  side: PartySide,
  now: Date
): ExtraSessionRefusal | null => {
  if (extra.status !== 'proposed') return 'nothing_to_answer';
  if (extra.proposedBySide === side) return 'wrong_side';
  if (now.getTime() >= extra.respondBy.getTime()) return 'response_window_closed';
  return null;
};

/** Null when `side` may withdraw `extra` now. */
export const checkExtraSessionWithdrawal = (
  extra: Pick<ExtraSession, 'status' | 'proposedBySide' | 'respondBy'>,
  side: PartySide,
  now: Date
): ExtraSessionRefusal | null => {
  if (extra.status !== 'proposed') return 'not_withdrawable';
  if (extra.proposedBySide !== side) return 'wrong_side';
  if (now.getTime() >= extra.respondBy.getTime()) return 'response_window_closed';
  return null;
};

/** Null when an agreed extra session may still be cancelled at no cost. */
export const checkExtraSessionCancellation = (
  extra: Pick<ExtraSession, 'status' | 'chargeAt'>,
  now: Date
): ExtraSessionRefusal | null =>
  extra.status === 'agreed' && extra.chargeAt !== null && now.getTime() < extra.chargeAt.getTime()
    ? null
    : 'not_cancellable';

/** What one viewer may do with an extra session now. */
export const extraSessionActions = (
  extra: ExtraSession,
  side: PartySide,
  now: Date
): Array<'accept' | 'decline' | 'withdraw' | 'cancel'> => [
  ...(checkExtraSessionAnswer(extra, side, now) === null ? (['accept', 'decline'] as const) : []),
  ...(checkExtraSessionWithdrawal(extra, side, now) === null ? (['withdraw'] as const) : []),
  ...(checkExtraSessionCancellation(extra, now) === null ? (['cancel'] as const) : [])
];

// ---------------------------------------------------------------------------
// Context and pricing

/** Everything a check reads about the contract; null without billing. */
export const loadExtraSessionContext = (contractId: string) =>
  Effect.gen(function* () {
    const contracts = yield* ContractRepo;
    const billingRepo = yield* ContractBillingRepo;
    const contract = yield* contracts.findById(contractId);
    const billing = yield* billingRepo.findBilling(contractId);
    if (!contract || !billing) return null;
    const accepted = (yield* contracts.listVersions(contractId)).find(
      (version) => version.id === billing.acceptedVersionId
    );
    if (!accepted) return null;
    const end = effectiveEnd(contract, accepted);
    return {
      contract,
      billing,
      accepted,
      zone: billing.timeZone,
      endsOn: end?.endsOn ?? null,
      endsAtMinutes: end?.endsAtMinutes ?? null,
      sessions: yield* billingRepo.listSessions(contractId),
      cycles: yield* billingRepo.listCycles(contractId),
      extras: yield* (yield* ExtraSessionRepo).listForContract(contractId)
    } satisfies ExtraSessionContext;
  });

export type ExtraSessionPrice = {
  serviceName: string;
  rateCents: number;
  elapsedMinutes: number;
  valueCents: number;
  startsAt: Date;
  endsAt: Date;
  amounts: ContractAmounts;
};

/** Every tax line of a quote (both sides'), as frozen on the extra session. */
const allLines = (amounts: ContractAmounts): Array<TaxLine> => [
  ...amounts.serviceTaxLines,
  ...amounts.familyFeeTaxLines,
  ...amounts.providerCommissionTaxLines
];
const familyLines = (amounts: ContractAmounts): Array<TaxLine> => [
  ...amounts.serviceTaxLines,
  ...amounts.familyFeeTaxLines
];
const sumLines = (lines: ReadonlyArray<{ taxCents: number }>) =>
  lines.reduce((total, line) => total + line.taxCents, 0);

/**
 * The extra session priced exactly like a cycle of its own: care at the
 * contract's agreed rate for the elapsed minutes, the contract's frozen
 * family fee and commission, the current tax configuration for its date.
 * Null when it can't be priced or is under the provider's minimum.
 */
export const priceExtraSession = (
  billing: ContractBilling,
  accepted: Pick<ContractVersion, 'services'>,
  slot: ExtraSessionSlot
) =>
  Effect.gen(function* () {
    const service = accepted.services.find((row) => row.serviceId === slot.serviceId);
    if (!service) return null;
    const elapsedMinutes = sessionElapsedMinutes(slot.date, slot, billing.timeZone);
    const valueCents = sessionValueCents(service.rateCents, elapsedMinutes);
    const snapshot = yield* loadTaxSnapshot;
    const quoted = quoteContractAmounts({
      serviceCents: valueCents,
      familyFeeBps: billing.familyFeeBps,
      providerCommissionBps: billing.providerCommissionBps,
      snapshot,
      on: slot.date,
      familyProvince: billing.familyProvince as ProvinceCode,
      helperProvince: billing.helperProvince as ProvinceCode
    });
    if (!quoted.ok || quoted.amounts.familyTotalCents < MINIMUM_CHARGE_CENTS || valueCents <= 0) {
      return null;
    }
    return {
      serviceName: service.name,
      rateCents: service.rateCents,
      elapsedMinutes,
      valueCents,
      ...slotInstants(slot, billing.timeZone),
      amounts: quoted.amounts
    } satisfies ExtraSessionPrice;
  });

/** A slot checked and priced for a proposal (the propose dialog's preview). */
export const quoteExtraSession = (contractId: string, slot: ExtraSessionSlot, now: Date) =>
  Effect.gen(function* () {
    const ctx = yield* loadExtraSessionContext(contractId);
    if (!ctx) return yield* refuse('contract_not_active');
    const policy = yield* extraSessionPolicy;
    const refusal = checkExtraSessionSlot(slot, ctx, now, policy);
    if (refusal) return yield* refuse(refusal);
    const price = yield* priceExtraSession(ctx.billing, ctx.accepted, slot);
    if (!price) return yield* refuse('not_priced');
    return price;
  });

// ---------------------------------------------------------------------------
// Notices

const noticeFor = (
  event: ExtraSessionEvent,
  extra: ExtraSession,
  actorUserId: string | null,
  cycle?: ContractCycle | null
) =>
  Effect.gen(function* () {
    const contract = yield* (yield* ContractRepo).findById(extra.contractId);
    const billing = yield* (yield* ContractBillingRepo).findBilling(extra.contractId);
    if (!contract || !billing) return;
    const policy = yield* extraSessionPolicy;
    yield* sendExtraSessionNotice(event, {
      contract,
      extra,
      actorUserId,
      zone: billing.timeZone,
      chargeDelayMinutes: policy.chargeDelayMinutes,
      retryHours: policy.retryHours,
      cycle: cycle ? { startsOn: cycle.startsOn, endsOn: cycle.endsOn } : null
    });
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(`[extra-sessions] notice ${event} for ${extra.id} failed`, error)
    )
  );

const mapOverlap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is E => (error as { _tag?: string })._tag === 'ExtraSessionOverlapError',
      () => refuse('overlap')
    )
  );

// ---------------------------------------------------------------------------
// Proposing, answering, withdrawing, cancelling

export type ProposeExtraSessionInput = ExtraSessionSlot & {
  note: string | null;
  /** The family's "I authorise Poppynz to charge my card $X": the amount it
   * was shown, in cents (null for the helper, or when not ticked). */
  authorisedCents: number | null;
};

/** One side proposes an extra session. A family's proposal carries its
 * authorisation of the charge, for exactly the amount it costs now. */
export const proposeExtraSession = (
  contractId: string,
  actor: { userId: string; side: PartySide },
  input: ProposeExtraSessionInput,
  now: Date
) =>
  Effect.gen(function* () {
    const ctx = yield* loadExtraSessionContext(contractId);
    if (!ctx) return yield* refuse('contract_not_active');
    const policy = yield* extraSessionPolicy;
    const refusal = checkExtraSessionSlot(input, ctx, now, policy);
    if (refusal) return yield* refuse(refusal);
    const price = yield* priceExtraSession(ctx.billing, ctx.accepted, input);
    if (!price) return yield* refuse('not_priced');
    const total = price.amounts.familyTotalCents;
    if (actor.side === 'family') {
      if (input.authorisedCents === null) return yield* refuse('authorisation_required');
      if (input.authorisedCents !== total) return yield* refuse('amount_changed');
    }
    const row = yield* (yield* ExtraSessionRepo)
      .propose(
        {
          contractId,
          proposedByUserId: actor.userId,
          proposedBySide: actor.side,
          date: input.date,
          startMinutes: input.startMinutes,
          endMinutes: input.endMinutes,
          startsAt: price.startsAt,
          endsAt: price.endsAt,
          elapsedMinutes: price.elapsedMinutes,
          serviceId: input.serviceId,
          serviceName: price.serviceName,
          rateCents: price.rateCents,
          valueCents: price.valueCents,
          quotedTotalCents: total,
          note: input.note,
          status: 'proposed',
          respondBy: new Date(now.getTime() + policy.responseHours * HOUR_MS),
          cycleId: cycleCovering(ctx.cycles, input.date)?.id ?? null,
          familyAuthorisedAt: actor.side === 'family' ? now : null,
          familyAuthorisedCents: actor.side === 'family' ? total : null
        },
        { actorUserId: actor.userId, actorSide: actor.side, action: 'proposed', note: input.note }
      )
      .pipe(mapOverlap);
    yield* noticeFor('proposed', row, actor.userId);
    return row;
  });

const findOwn = (contractId: string, extraId: string) =>
  Effect.gen(function* () {
    const extra = yield* (yield* ExtraSessionRepo).find(extraId);
    if (!extra || extra.contractId !== contractId) {
      return yield* Effect.fail(new ExtraSessionNotFoundError());
    }
    return extra;
  });

export type AnswerExtraSessionInput = {
  response: 'accept' | 'decline';
  note: string | null;
  /** The family's authorisation when it confirms the helper's proposal. */
  authorisedCents: number | null;
};

/** The other side answers. Accepting makes it a dated session whose charge
 * waits for the delay; declining ends it. */
export const answerExtraSession = (
  contractId: string,
  extraId: string,
  actor: { userId: string; side: PartySide },
  input: AnswerExtraSessionInput,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const extra = yield* findOwn(contractId, extraId);
    const answer = checkExtraSessionAnswer(extra, actor.side, now);
    if (answer) return yield* refuse(answer);
    const audit = (action: string): ExtraSessionAudit => ({
      actorUserId: actor.userId,
      actorSide: actor.side,
      action,
      note: input.note
    });
    if (input.response === 'decline') {
      const declined = yield* advanceExtra(
        extra.id,
        {
          from: ['proposed'],
          set: {
            status: 'declined',
            respondedByUserId: actor.userId,
            respondedAt: now,
            responseNote: input.note
          }
        },
        audit('declined')
      );
      if (!declined) return yield* refuse('response_window_closed');
      yield* noticeFor('declined', declined, actor.userId);
      return declined;
    }
    const ctx = yield* loadExtraSessionContext(contractId);
    if (!ctx) return yield* refuse('contract_not_active');
    const policy = yield* extraSessionPolicy;
    const refusal = checkExtraSessionSlot(extra, ctx, now, policy, { answering: extra });
    if (refusal) return yield* refuse(refusal);
    const price = yield* priceExtraSession(ctx.billing, ctx.accepted, extra);
    if (!price) return yield* refuse('not_priced');
    const total = price.amounts.familyTotalCents;
    if (actor.side === 'family') {
      if (input.authorisedCents === null) return yield* refuse('authorisation_required');
      if (input.authorisedCents !== total) return yield* refuse('amount_changed');
    } else if (extra.familyAuthorisedCents !== total) {
      // The price moved since the family authorised it (a tax change): the
      // family must propose again — never charge more than it authorised.
      return yield* refuse('amount_changed');
    }
    const cycle = cycleCovering(ctx.cycles, extra.date)!;
    const agreed = yield* repo
      .agree(
        extra.id,
        {
          from: ['proposed'],
          set: {
            status: 'agreed',
            respondedByUserId: actor.userId,
            respondedAt: now,
            responseNote: input.note,
            agreedAt: now,
            chargeAt: new Date(now.getTime() + policy.chargeDelayMinutes * MINUTE_MS),
            cycleId: cycle.id,
            quotedTotalCents: total,
            ...(actor.side === 'family'
              ? { familyAuthorisedAt: now, familyAuthorisedCents: total }
              : {})
          },
          session: {
            contractId,
            cycleId: cycle.id,
            date: extra.date,
            slot: `extra:${extra.id}`,
            serviceId: extra.serviceId,
            serviceName: price.serviceName,
            startMinutes: extra.startMinutes,
            endMinutes: extra.endMinutes,
            startsAt: price.startsAt,
            endsAt: price.endsAt,
            elapsedMinutes: price.elapsedMinutes,
            rateCents: price.rateCents,
            valueCents: price.valueCents,
            status: 'scheduled'
          }
        },
        audit('agreed')
      )
      .pipe(mapOverlap);
    if (!agreed) return yield* refuse('response_window_closed');
    yield* noticeFor('agreed', agreed.extra, actor.userId);
    // No delay configured: the charge step runs at once.
    // Best-effort: the agreement stands whatever the charge step meets (the
    // tick picks it up otherwise).
    if (policy.chargeDelayMinutes === 0) {
      return (
        (yield* processDueExtraSession(agreed.extra, now).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`[extra-sessions] charge of ${agreed.extra.id} deferred`, error).pipe(
              Effect.as(null)
            )
          )
        )) ?? agreed.extra
      );
    }
    return agreed.extra;
  });

/** The proposer takes their proposal back before it is answered. */
export const withdrawExtraSession = (
  contractId: string,
  extraId: string,
  actor: { userId: string; side: PartySide },
  now: Date
) =>
  Effect.gen(function* () {
    const extra = yield* findOwn(contractId, extraId);
    const refusal = checkExtraSessionWithdrawal(extra, actor.side, now);
    if (refusal) return yield* refuse(refusal);
    const moved = yield* advanceExtra(
      extra.id,
      { from: ['proposed'], set: { status: 'withdrawn' } },
      { actorUserId: actor.userId, actorSide: actor.side, action: 'withdrawn' }
    );
    if (!moved) return yield* refuse('not_withdrawable');
    yield* noticeFor('withdrawn', moved, actor.userId);
    return moved;
  });

/** Either side cancels an agreed extra session during its charge delay, at
 * no cost: its session is cancelled and nothing is ever charged for it. */
export const cancelExtraSession = (
  contractId: string,
  extraId: string,
  actor: { userId: string; side: PartySide },
  now: Date
) =>
  Effect.gen(function* () {
    const extra = yield* findOwn(contractId, extraId);
    const refusal = checkExtraSessionCancellation(extra, now);
    if (refusal) return yield* refuse(refusal);
    const moved = yield* (yield* ExtraSessionRepo).cancel(
      extra.id,
      {
        from: ['agreed'],
        set: { status: 'cancelled', cancelledByUserId: actor.userId, cancelledAt: now },
        sessionFrom: ['scheduled', 'completed', 'suspended']
      },
      { actorUserId: actor.userId, actorSide: actor.side, action: 'cancelled' }
    );
    // The charge step took it a moment ago.
    if (!moved) return yield* refuse('not_cancellable');
    yield* noticeFor('cancelled', moved, actor.userId);
    return moved;
  });

// ---------------------------------------------------------------------------
// The charge

const SYSTEM: Omit<ExtraSessionAudit, 'action'> = { actorUserId: null, actorSide: 'system' };

const findPayment = (paymentId: string | null) =>
  paymentId === null
    ? Effect.succeed(null)
    : PaymentRepo.pipe(
        Effect.flatMap((repo) => repo.findById(paymentId)),
        Effect.catchTag('DBNotFoundError', () => Effect.succeed(null))
      );

const sessionOf = (extra: ExtraSession) =>
  Effect.gen(function* () {
    if (extra.sessionId === null) return null;
    return (
      (yield* (yield* ContractBillingRepo).listSessions(
        extra.contractId,
        extra.cycleId ?? undefined
      )).find((row) => row.id === extra.sessionId) ?? null
    );
  });

/** Its session no longer takes place (cancelled by a resolution, by the
 * contract's end, or suspended with nothing to charge): nothing is charged. */
const chargeable = (session: SessionRecord | null) =>
  session !== null &&
  (session.status === 'scheduled' ||
    session.status === 'completed' ||
    session.status === 'disputed');

const abandon = (extra: ExtraSession, reason: string) =>
  Effect.gen(function* () {
    const moved = yield* advanceExtra(
      extra.id,
      {
        from: ['agreed', 'charge_failed'],
        set: { status: 'cancelled', nextRetryAt: null, lastError: reason }
      },
      { ...SYSTEM, action: 'abandoned', note: reason }
    );
    if (moved) yield* noticeFor('cancelled', moved, null);
    return moved;
  });

/**
 * The delay is over: fold the session into its cycle's charge when that
 * charge is still to come and can take it, else charge it on its own. A
 * cycle whose money is in flight (hold or capture) is left for the next
 * tick.
 */
export const processDueExtraSession = (
  extra: ExtraSession,
  now: Date
): Effect.Effect<ExtraSession | null, ExtraError, ExtraSessionDeps> =>
  Effect.gen(function* () {
    if (extra.status !== 'agreed' || extra.chargeAt === null || now < extra.chargeAt) {
      return extra;
    }
    const session = yield* sessionOf(extra);
    if (!chargeable(session)) return yield* abandon(extra, 'its session no longer takes place');
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(extra.contractId);
    const cycle = (yield* billingRepo.listCycles(extra.contractId)).find(
      (row) => row.id === extra.cycleId
    );
    if (!billing || !cycle) return extra;
    const repo = yield* ExtraSessionRepo;
    let fold = false;
    switch (cycle.status) {
      case 'authorising':
      case 'capturing':
        return extra;
      case 'scheduled':
      case 'grace':
        fold = liveBillingStatuses.includes(billing.status) && billing.status !== 'suspended';
        break;
      case 'authorised': {
        // Folded only when the re-quoted capture still fits under the hold
        // (a capture never takes more than was held).
        const sessions = (yield* billingRepo.listSessions(extra.contractId, cycle.id)).map((row) =>
          row.id === session!.id ? { ...row, chargeRoute: 'cycle' as const } : row
        );
        const quote = yield* quoteCycleSessions(billing, cycle, sessions);
        const payment = yield* findPayment(cycle.paymentId);
        const held = cycle.heldCents ?? payment?.totalCents ?? 0;
        fold = quote.ok && quote.amounts.familyTotalCents <= held;
        break;
      }
      default:
        fold = false;
    }
    if (fold) {
      // Folded only at a price the family authorised: a price that rose
      // since (a tax change) goes to `startCharge`, which holds it for an
      // admin rather than charge more than authorised.
      const accepted = (yield* (yield* ContractRepo).listVersions(extra.contractId)).find(
        (version) => version.id === billing.acceptedVersionId
      );
      const price = accepted ? yield* priceExtraSession(billing, accepted, extra) : null;
      const authorised = extra.familyAuthorisedCents ?? extra.quotedTotalCents;
      fold = price !== null && price.amounts.familyTotalCents <= authorised;
    }
    if (fold) {
      const folded = yield* repo.route(
        extra.id,
        { from: ['agreed'], set: { status: 'in_cycle' }, route: 'cycle' },
        { ...SYSTEM, action: 'folded', note: `cycle ${cycle.index + 1} (${cycle.status})` }
      );
      if (folded) yield* noticeFor('in_cycle', folded, null, cycle);
      return folded;
    }
    return yield* startCharge(extra, ['agreed'], now);
  });

/** "Extra session with Sam T. · Tue, Nov 3" */
const describe = (extra: ExtraSession, helperUserId: string) =>
  Effect.gen(function* () {
    const helper = yield* personName(helperUserId);
    return `Extra session with ${helper.name} · ${cycleDates({ startsOn: extra.date, endsOn: extra.date })}`;
  });

/** A new attempt of its own charge: the payment row first (its breakdown
 * and card frozen there), then the row claimed for it by compare-and-set,
 * then the provider. */
const startCharge = (
  extra: ExtraSession,
  from: ReadonlyArray<ExtraSession['status']>,
  now: Date
): Effect.Effect<ExtraSession | null, ExtraError, ExtraSessionDeps> =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const contract = yield* (yield* ContractRepo).findById(extra.contractId);
    const billing = yield* (yield* ContractBillingRepo).findBilling(extra.contractId);
    const accepted = contract
      ? (yield* (yield* ContractRepo).listVersions(contract.id)).find(
          (version) => version.id === billing?.acceptedVersionId
        )
      : undefined;
    if (!contract || !billing || !accepted) return extra;
    const price = yield* priceExtraSession(billing, accepted, extra);
    const authorised = extra.familyAuthorisedCents ?? extra.quotedTotalCents;
    if (price === null || price.amounts.familyTotalCents > authorised) {
      // Never more than the family authorised (a tax change since), and
      // never a guess: an admin looks at it.
      const reason =
        price === null
          ? 'the extra session could not be priced'
          : `it now costs ${price.amounts.familyTotalCents} cents, more than the ${authorised} authorised`;
      const held = yield* repo.route(
        extra.id,
        {
          from,
          attempts: extra.chargeAttempts,
          set: { status: 'charge_failed', lastError: reason, nextRetryAt: null },
          route: 'separate'
        },
        { ...SYSTEM, action: 'charge_held', note: reason }
      );
      if (held && (yield* repo.appendNotice(held.id, 'price_alert'))) {
        yield* alertAdmins(`Extra session ${extra.id} was not charged`, [
          `Contract ${extra.contractId}, ${extra.serviceName} on ${extra.date}: ${reason}.`,
          'Nothing was charged; settle it with the family.'
        ]);
      }
      return held;
    }
    const amounts = price.amounts;
    const payments = yield* Payments;
    const customer = yield* (yield* BillingCustomerRepo).findByUserId(contract.familyUserId);
    const card = toCard(customer, payments.provider);
    const attempt = extra.chargeAttempts + 1;
    const payment = yield* (yield* PaymentRepo).create({
      userId: contract.familyUserId,
      kind: 'contract_extra_session',
      provider: payments.provider,
      amountCents: amounts.serviceCents,
      feeCents: amounts.familyFeeCents,
      taxCents: sumLines(familyLines(amounts)),
      totalCents: amounts.familyTotalCents,
      taxLines: familyLines(amounts).map((line) => ({ ...line })),
      description: yield* describe(extra, contract.providerUserId),
      cardReference: card?.reference ?? null,
      chargeKey: `extra-${extra.id}-${attempt}`
    });
    const claimed = yield* repo.route(
      extra.id,
      {
        from,
        // A stale read (another attempt started since) never reuses a key.
        attempts: extra.chargeAttempts,
        set: {
          status: 'charging',
          paymentId: payment.id,
          chargeAttempts: attempt,
          nextRetryAt: null,
          lastError: null,
          familyTotalCents: amounts.familyTotalCents,
          taxLines: allLines(amounts).map((line) => ({ ...line }))
        },
        route: 'separate'
      },
      { ...SYSTEM, action: 'charge_started', note: `attempt ${attempt}` }
    );
    if (!claimed) {
      yield* (yield* PaymentRepo).advance(payment.id, {
        from: 'pending',
        set: { status: 'failed', lastError: 'superseded by a concurrent attempt' }
      });
      return null;
    }
    return yield* chargeAndSettle(claimed, payment, now);
  });

/** The one request an attempt is ever sent as (its own card and key). */
const chargeRequest = (extra: ExtraSession, payment: Payment) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const customer = yield* (yield* BillingCustomerRepo).findByUserId(payment.userId);
    const card = payment.cardReference ?? toCard(customer, payments.provider)?.reference ?? null;
    if (customer === null || card === null) return null;
    return {
      amountCents: payment.totalCents,
      currency: 'CAD',
      customer: customer.customerReference,
      card,
      capture: 'automatic',
      idempotencyKey: payment.chargeKey ?? `extra-${extra.id}-${extra.chargeAttempts}`,
      metadata: {
        payment_id: payment.id,
        extra_session_id: extra.id,
        session_id: extra.sessionId ?? '',
        cycle_id: extra.cycleId ?? '',
        contract_id: extra.contractId,
        kind: 'contract_extra_session'
      },
      ...(payment.description ? { description: payment.description } : {})
    } satisfies ChargeSavedCardInput as ChargeSavedCardInput;
  });

/** Calls the provider for the current attempt and settles its answer. A
 * provider error leaves the attempt pending: the tick replays the same
 * request (never a second charge). */
const chargeAndSettle = (
  extra: ExtraSession,
  payment: Payment,
  now: Date
): Effect.Effect<ExtraSession | null, ExtraError, ExtraSessionDeps> =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const request = yield* chargeRequest(extra, payment);
    if (request === null) {
      const failed =
        (yield* paymentRepo.advance(payment.id, {
          from: 'pending',
          set: { status: 'failed', lastError: 'There is no card on file.' }
        })) ?? payment;
      return yield* onDeclined(failed, 'There is no card on file.', now);
    }
    const result = yield* (yield* Payments).chargeSavedCard(request).pipe(Effect.either);
    if (Either.isLeft(result)) {
      yield* Effect.logWarning(`[extra-sessions] provider error charging ${extra.id}`, result.left);
      yield* paymentRepo.update(payment.id, {
        lastError: 'payment provider unavailable — retrying'
      });
      return extra;
    }
    yield* paymentRepo.advance(payment.id, {
      from: 'pending',
      providerReference: null,
      set: { providerReference: result.right.reference }
    });
    yield* settleExtraSessionRow(yield* paymentRepo.findById(payment.id), now, result.right);
    return yield* (yield* ExtraSessionRepo).find(extra.id);
  });

/** Declined (or refused): retried on schedule and on a new card; the
 * contract is never suspended for it. The family is told once per decline
 * streak, the helper once. */
const onDeclined = (payment: Payment, reason: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const extra = yield* repo.findByPaymentId(payment.id);
    if (!extra || extra.status !== 'charging') return extra;
    const policy = yield* extraSessionPolicy;
    const more = extra.chargeAttempts < policy.maxChargeAttempts;
    const moved = yield* advanceExtra(
      extra.id,
      {
        from: ['charging'],
        set: {
          status: 'charge_failed',
          lastError: reason,
          nextRetryAt: more ? new Date(now.getTime() + policy.retryHours * HOUR_MS) : null
        }
      },
      { ...SYSTEM, action: 'charge_declined', note: reason }
    );
    if (
      moved &&
      (yield* repo.appendNotice(
        moved.id,
        `declined:${moved.chargeAttempts === 1 ? 'first' : moved.chargeAttempts}`
      ))
    ) {
      // Told on the first decline, and again when automatic retries stop.
      if (moved.chargeAttempts === 1 || !more) yield* noticeFor('charge_failed', moved, null);
    }
    return moved;
  });

/** The attempt never reached the provider, or its answer was lost: retried
 * now with a new attempt (nobody's fault, so no notice). */
const onUnanswered = (payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const extra = yield* repo.findByPaymentId(payment.id);
    if (!extra || extra.status !== 'charging') return extra;
    return yield* advanceExtra(
      extra.id,
      {
        from: ['charging'],
        set: { status: 'charge_failed', lastError: UNANSWERED, nextRetryAt: now }
      },
      { ...SYSTEM, action: 'charge_unanswered', note: UNANSWERED }
    );
  });

/** Its own charge succeeded: the frozen split of one session (the session
 * is its own cycle) and the ledger, with the status, in one transaction. */
const onCharged = (extra: ExtraSession, payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(extra.contractId);
    if (!billing || extra.sessionId === null || extra.cycleId === null) return extra;
    const lines = (supplyType: string) =>
      extra.taxLines.filter((line) => line.supplyType === supplyType);
    const careTaxLines = lines('care_service_value');
    const feeTaxLines = lines('family_service_fee');
    const commissionTaxLines = lines('provider_commission');
    const careTaxCents = sumLines(careTaxLines);
    const commissionCents = applyBps(extra.valueCents, billing.providerCommissionBps);
    const commissionTaxCents = sumLines(commissionTaxLines);
    const captured = payment.capturedCents ?? payment.totalCents;
    const familyTotal = extra.valueCents + careTaxCents + payment.feeCents + sumLines(feeTaxLines);
    if (familyTotal !== captured) {
      // Never a split that disagrees with the money: no charge row (so
      // nothing is refunded or paid from it) until an admin fixes it.
      const recorded = yield* billingRepo.recordIncident({
        contractId: extra.contractId,
        cycleId: extra.cycleId,
        kind: `extra_session_split:${extra.id}`,
        detail: `split total ${familyTotal} differs from the capture ${captured}`
      });
      if (recorded) {
        yield* alertAdmins(`Extra session ${extra.id} cannot be split`, [
          `Contract ${extra.contractId}: split total ${familyTotal} differs from the capture ${captured} (payment ${payment.id}).`,
          'Its refunds and the helper’s pay wait until it is fixed.'
        ]);
      }
      return extra;
    }
    const charge: SessionChargeInsert = {
      sessionId: extra.sessionId,
      cycleId: extra.cycleId,
      contractId: extra.contractId,
      paymentId: payment.id,
      basis: 'session',
      careCents: extra.valueCents,
      careTaxLines: careTaxLines.map((line) => ({ ...line })),
      careTaxCents,
      familyFeeCents: payment.feeCents,
      familyFeeTaxLines: feeTaxLines.map((line) => ({ ...line })),
      familyFeeTaxCents: sumLines(feeTaxLines),
      familyTotalCents: familyTotal,
      commissionCents,
      commissionTaxLines: commissionTaxLines.map((line) => ({ ...line })),
      commissionTaxCents,
      helperShareCents: extra.valueCents + careTaxCents - commissionCents - commissionTaxCents
    };
    const base = {
      contractId: extra.contractId,
      cycleId: extra.cycleId,
      sessionId: extra.sessionId
    };
    const key = (suffix: string) => `extra:${extra.id}:${suffix}`;
    const taxEntries = (
      taxLines: ReadonlyArray<(typeof extra.taxLines)[number]>,
      kind: BillingLedgerInsert['kind']
    ): Array<BillingLedgerInsert> =>
      taxLines
        .filter((line) => line.taxCents > 0)
        .map((line) => ({
          ...base,
          entryKey: key(`${kind}:${line.jurisdiction}:${line.component}`),
          kind,
          party: 'platform' as const,
          amountCents: line.taxCents,
          label: line.label
        }));
    const ledger: Array<BillingLedgerInsert> = [
      {
        ...base,
        entryKey: key('session'),
        kind: 'session',
        party: 'family',
        amountCents: extra.valueCents,
        label: `${extra.serviceName} ${extra.date} (extra)`
      },
      ...taxEntries(careTaxLines, 'service_tax'),
      {
        ...base,
        entryKey: key('family_fee'),
        kind: 'family_fee',
        party: 'platform',
        amountCents: payment.feeCents
      },
      ...taxEntries(feeTaxLines, 'family_fee_tax'),
      {
        ...base,
        entryKey: key('provider_commission'),
        kind: 'provider_commission',
        party: 'platform',
        amountCents: commissionCents
      },
      ...taxEntries(commissionTaxLines, 'provider_commission_tax'),
      {
        ...base,
        paymentId: payment.id,
        entryKey: key(`capture:${payment.id}`),
        kind: 'capture',
        party: 'family',
        amountCents: captured
      }
    ];
    const charged = yield* (yield* ExtraSessionRepo).markCharged(
      extra.id,
      {
        from: ['charging', 'charge_failed'],
        set: {
          status: 'charged',
          paymentId: payment.id,
          chargedAt: payment.capturedAt ?? now,
          lastError: null,
          nextRetryAt: null
        },
        charge,
        ledger
      },
      { ...SYSTEM, action: 'charged', note: payment.providerReference }
    );
    if (charged) yield* noticeFor('charged', charged, null);
    return charged ?? extra;
  });

/** A charge that landed on an attempt that was given up (a later attempt
 * took over, or the session was cancelled): never kept — refunded, and an
 * admin told once. */
const releaseOrphan = (row: Payment, fetched: ProviderPayment) =>
  Effect.gen(function* () {
    if (fetched.status !== 'succeeded' || fetched.refundedCents > 0) {
      if (fetched.status !== 'canceled' && fetched.status !== 'succeeded') {
        yield* (yield* Payments)
          .cancelPayment(fetched.reference)
          .pipe(Effect.catchAll(() => Effect.void));
      }
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    const refund = yield* (yield* Payments).refund({
      reference: fetched.reference,
      reason: 'charge on an extra-session attempt that was given up',
      idempotencyKey: `orphan-${fetched.reference}`
    });
    const recorded =
      (yield* (yield* PaymentRepo).advance(row.id, {
        from: ['pending', 'failed', 'refunded'],
        set: {
          status: 'refunded',
          providerReference: fetched.reference,
          refundReference: refund.refundReference,
          refundedAt: refund.refundedAt,
          lastError: 'charge landed after the attempt was given up — refunded'
        }
      })) ?? row;
    yield* alertAdmins(`Extra-session charge refunded automatically (${fetched.reference})`, [
      `Payment ${row.id} took ${fetched.amountCents} cents after its attempt was given up; it was refunded.`
    ]);
    return { outcome: 'released' as CycleSettleOutcome, payment: recorded };
  });

/**
 * The extra-session branch of the one settle path (browser, webhook,
 * recovery job, tick): re-fetches unless the caller just got the provider's
 * answer, checks it against the row, applies it by compare-and-set. Safe to
 * repeat from any caller, in any order.
 */
export const settleExtraSessionRow = (
  row: Payment,
  now: Date,
  answered?: ProviderPayment
): Effect.Effect<{ outcome: CycleSettleOutcome; payment: Payment }, ExtraError, ExtraSessionDeps> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const repo = yield* ExtraSessionRepo;
    const extra = yield* repo.findByPaymentId(row.id);
    const current = extra !== null && extra.paymentId === row.id;
    if (row.status === 'captured') {
      if (current && extra.status !== 'charged') yield* onCharged(extra, row, now);
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    if (row.status === 'failed' || row.status === 'refunded') {
      if (current && extra.status === 'charging') {
        if (row.lastError === UNANSWERED) yield* onUnanswered(row, now);
        else yield* onDeclined(row, row.lastError ?? 'The card was declined.', now);
      }
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    if (row.provider !== payments.provider) {
      return { outcome: 'skipped' as CycleSettleOutcome, payment: row };
    }
    if (row.providerReference === null) {
      return { outcome: 'pending' as CycleSettleOutcome, payment: row };
    }
    const fetched =
      answered && answered.reference === row.providerReference
        ? answered
        : yield* payments.getPayment(row.providerReference);
    const mismatch = mismatchReason(row, fetched);
    if (mismatch !== null) {
      const flagged = yield* paymentRepo.update(row.id, { lastError: mismatch });
      yield* alertAdmins(`Provider payment does not match payment ${row.id}`, [
        `Extra session ${extra?.id ?? '(unknown)'}: ${mismatch}.`,
        fetched.status === 'succeeded'
          ? 'The provider shows it as charged: check it and refund by hand.'
          : 'Nothing was recorded as charged.'
      ]);
      return { outcome: 'mismatch' as CycleSettleOutcome, payment: flagged };
    }
    if (!current || (extra.status !== 'charging' && extra.status !== 'charge_failed')) {
      // An attempt that is no longer the current one: never kept.
      return yield* releaseOrphan(row, fetched);
    }
    switch (fetched.status) {
      case 'succeeded': {
        const captured =
          (yield* paymentRepo.advance(row.id, {
            from: ['pending', 'authorised'],
            set: {
              status: 'captured',
              capturedAt: now,
              capturedCents: fetched.receivedCents > 0 ? fetched.receivedCents : row.totalCents,
              receiptUrl: fetched.receiptUrl,
              lastError: null
            }
          })) ?? (yield* paymentRepo.findById(row.id));
        if (captured.status === 'captured') yield* onCharged(extra, captured, now);
        return { outcome: 'captured' as CycleSettleOutcome, payment: captured };
      }
      case 'failed':
      case 'requires_action':
      case 'canceled': {
        // A declined attempt could still be confirmed with another card at
        // the provider: cancel it first so it is terminal.
        const after =
          fetched.status === 'canceled'
            ? fetched
            : yield* payments.cancelPayment(row.providerReference);
        if (after.status === 'succeeded') return yield* settleExtraSessionRow(row, now, after);
        const reason = fetched.failureReason ?? 'The card was declined.';
        const failed =
          (yield* paymentRepo.advance(row.id, {
            from: 'pending',
            set: { status: 'failed', lastError: reason }
          })) ?? row;
        yield* onDeclined(failed, reason, now);
        return { outcome: 'declined' as CycleSettleOutcome, payment: failed };
      }
      default:
        return { outcome: 'pending' as CycleSettleOutcome, payment: row };
    }
  });

/** A provider payment naming our row that the row never recorded (its
 * response was lost): adopted while it is the current attempt, released
 * otherwise. */
export const adoptExtraSessionPayment = (row: Payment, fetched: ProviderPayment, now: Date) =>
  Effect.gen(function* () {
    if (fetched.metadata.payment_id !== row.id) {
      return { outcome: 'mismatch' as CycleSettleOutcome, payment: row };
    }
    const paymentRepo = yield* PaymentRepo;
    const recorded =
      row.status === 'pending' && row.providerReference === null
        ? ((yield* paymentRepo.advance(row.id, {
            from: 'pending',
            providerReference: null,
            set: { providerReference: fetched.reference }
          })) ?? (yield* paymentRepo.findById(row.id)))
        : row;
    if (recorded.providerReference === fetched.reference && recorded.status === 'pending') {
      return yield* settleExtraSessionRow(recorded, now, fetched);
    }
    return yield* releaseOrphan(recorded, fetched);
  });

/** An attempt still `charging` on a tick: settled from what the provider
 * says (a lost answer, a webhook still on its way). Unanswered ones are
 * replayed under their key while the provider remembers it, else looked up;
 * a lookup that finds nothing (old enough) fails the attempt for a retry. */
const resolveCharging = (extra: ExtraSession, now: Date) =>
  Effect.gen(function* () {
    const payment = yield* findPayment(extra.paymentId);
    if (payment === null) return;
    if (payment.status !== 'pending' || payment.providerReference !== null) {
      yield* settleExtraSessionRow(payment, now).pipe(
        Effect.catchTag('PaymentProviderError', (error) =>
          Effect.logWarning(`[extra-sessions] could not re-fetch ${payment.id}`, error)
        )
      );
      return;
    }
    const age = now.getTime() - payment.createdAt.getTime();
    if (age < LOOKUP_AFTER_MS) return;
    if (age < REPLAY_WINDOW_MS) {
      yield* chargeAndSettle(extra, payment, now);
      return;
    }
    const found = yield* (yield* Payments).findPaymentByRowId(payment.id).pipe(Effect.either);
    if (Either.isLeft(found)) return;
    if (found.right !== null) {
      yield* adoptExtraSessionPayment(payment, found.right, now);
      return;
    }
    if (age < SEARCH_SETTLED_MS) return;
    const failed = yield* (yield* PaymentRepo).advance(payment.id, {
      from: 'pending',
      providerReference: null,
      set: { status: 'failed', lastError: UNANSWERED }
    });
    if (failed) yield* onUnanswered(failed, now);
  });

/** Unpaid for `CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS` since it was due:
 * an admin incident, once. */
const unpaidAlert = (extra: ExtraSession, now: Date) =>
  Effect.gen(function* () {
    const { unpaidAlertDays } = yield* extraSessionPolicy;
    const due = extra.chargeAt ?? extra.agreedAt;
    if (due === null || now.getTime() < due.getTime() + unpaidAlertDays * DAY_MS) return;
    const repo = yield* ExtraSessionRepo;
    if (!(yield* repo.appendNotice(extra.id, 'unpaid_alert'))) return;
    const reason = (extra.lastError ?? 'still being charged').replace(/\.+$/, '');
    const detail = `Extra session ${extra.id} (${extra.serviceName}, ${extra.date}) unpaid for ${unpaidAlertDays} days: ${reason}`;
    yield* (yield* ContractBillingRepo).recordIncident({
      contractId: extra.contractId,
      cycleId: extra.cycleId,
      kind: `extra_session_unpaid:${extra.id}`,
      detail
    });
    yield* alertAdmins(`Extra session unpaid on contract ${extra.contractId}`, [
      `${detail}.`,
      `${extra.chargeAttempts} attempt(s) so far. The regular contract is not suspended; the helper is paid for it once the charge succeeds.`,
      'It is listed under "Unpaid extra sessions" on the admin payouts page.'
    ]);
  });

/** The helper is paid for a charged extra session with its cycle's
 * transfer — or, when that went out already, with a follow-up. */
const ensurePaidOut = (extra: ExtraSession, now: Date) =>
  Effect.gen(function* () {
    if (extra.sessionId === null || extra.noticesSent.includes('paid_out')) return;
    const money = yield* SessionMoneyRepo;
    const items = yield* money.listTransferItems({ sessionIds: [extra.sessionId] });
    if (items.some((item) => item.kind === 'session' || item.kind === 'held')) {
      yield* (yield* ExtraSessionRepo).appendNotice(extra.id, 'paid_out');
      return;
    }
    const cycle = (yield* (yield* ContractBillingRepo).listCycles(extra.contractId)).find(
      (row) => row.id === extra.cycleId
    );
    if (!cycle) return;
    // Nothing owed for it now (refunded in full, or already recovered): no
    // follow-up to wait for — else one empty follow-up would be made and
    // settled on every tick. A later decision that owes the helper again
    // is paid by the money step's own follow-ups.
    const payable = (yield* cyclePayables(cycle)).find((row) => row.sessionId === extra.sessionId);
    if (!payable || (!payable.held && payable.payableCents === 0)) {
      yield* (yield* ExtraSessionRepo).appendNotice(extra.id, 'paid_out');
      return;
    }
    yield* ensureFollowUpTransfer(cycle, now);
  });

export type ExtraSessionTickSummary = {
  lapsed: number;
  folded: number;
  charged: number;
  declined: number;
  failed: number;
};

/**
 * The tick's extra-session step (worker and dev clock): unanswered
 * proposals lapse, agreed ones past their delay are folded or charged,
 * charges in flight are settled, declined ones retried on schedule (or
 * abandoned when their session no longer takes place), long-unpaid ones
 * alerted, and charged ones paid out. Each item is isolated.
 */
export const runExtraSessionTick = (now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const policy = yield* extraSessionPolicy;
    const summary: ExtraSessionTickSummary = {
      lapsed: 0,
      folded: 0,
      charged: 0,
      declined: 0,
      failed: 0
    };
    const isolate = <A>(id: string, effect: Effect.Effect<A, ExtraError, ExtraSessionDeps>) =>
      effect.pipe(
        Effect.exit,
        Effect.tap((exit) =>
          exit._tag === 'Failure'
            ? Effect.sync(() => void (summary.failed += 1)).pipe(
                Effect.zipRight(
                  Effect.logError(`[extra-sessions] extra session ${id} failed`, exit.cause)
                )
              )
            : Effect.void
        )
      );
    const count = (extra: ExtraSession | null | undefined) => {
      if (!extra) return;
      if (extra.status === 'in_cycle') summary.folded += 1;
      if (extra.status === 'charged') summary.charged += 1;
      if (extra.status === 'charge_failed') summary.declined += 1;
    };

    for (const extra of yield* repo.listByStatus(['proposed'])) {
      if (now < extra.respondBy) continue;
      yield* isolate(
        extra.id,
        Effect.gen(function* () {
          const lapsed = yield* advanceExtra(
            extra.id,
            { from: ['proposed'], set: { status: 'lapsed' } },
            { ...SYSTEM, action: 'lapsed', note: 'No answer within the response window.' }
          );
          if (lapsed) {
            summary.lapsed += 1;
            yield* noticeFor('lapsed', lapsed, null);
          }
        })
      );
    }
    for (const extra of yield* repo.listByStatus(['agreed'])) {
      if (extra.chargeAt === null || now < extra.chargeAt) continue;
      const exit = yield* isolate(extra.id, processDueExtraSession(extra, now));
      if (exit._tag === 'Success') count(exit.value);
    }
    for (const extra of yield* repo.listByStatus(['charging'])) {
      yield* isolate(extra.id, resolveCharging(extra, now));
      const after = yield* repo.find(extra.id);
      count(after);
      if (after && unpaidExtraSessionStatuses.includes(after.status)) {
        yield* isolate(extra.id, unpaidAlert(after, now));
      }
    }
    for (const extra of yield* repo.listByStatus(['charge_failed'])) {
      const exit = yield* isolate(
        extra.id,
        Effect.gen(function* () {
          if (!chargeable(yield* sessionOf(extra))) {
            return yield* abandon(extra, 'its session no longer takes place');
          }
          // Not retried now: not counted again (it was counted when declined).
          if (extra.nextRetryAt === null || now < extra.nextRetryAt) return null;
          if (extra.chargeAttempts >= policy.maxChargeAttempts && extra.lastError !== UNANSWERED) {
            return null;
          }
          return yield* startCharge(extra, ['charge_failed'], now);
        })
      );
      if (exit._tag === 'Success') count(exit.value);
      const after = yield* repo.find(extra.id);
      if (after && unpaidExtraSessionStatuses.includes(after.status)) {
        yield* isolate(extra.id, unpaidAlert(after, now));
      }
    }
    for (const extra of yield* repo.listByStatus(['charged'])) {
      if (extra.noticesSent.includes('paid_out')) continue;
      yield* isolate(extra.id, ensurePaidOut(extra, now));
    }
    return summary;
  });

/** The family replaced its card (or pressed "Retry payment"): every declined
 * extra-session charge on its contracts is tried again at once, past the
 * automatic attempt cap too. Resolves how many were retried. */
export const retryExtraSessionCharges = (
  familyUserId: string,
  now: Date,
  options: { contractId?: string } = {}
) =>
  Effect.gen(function* () {
    const repo = yield* ExtraSessionRepo;
    const contracts = yield* ContractRepo;
    let retried = 0;
    // Declined charges are few: each is matched to the family by its contract.
    for (const extra of yield* repo.listByStatus(['charge_failed'])) {
      if (options.contractId !== undefined && extra.contractId !== options.contractId) continue;
      const contract = yield* contracts.findById(extra.contractId);
      if (contract?.familyUserId !== familyUserId) continue;
      if (!chargeable(yield* sessionOf(extra))) continue;
      retried += 1;
      yield* startCharge(extra, ['charge_failed'], now).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(`[extra-sessions] retry of ${extra.id} failed`, error)
        )
      );
    }
    return retried;
  });

// ---------------------------------------------------------------------------
// The settle path's contract branch

/** Provides the contract branch of `settlePayment` (cycles and, Tier 3 step
 * 3, extra sessions) from contract billing's own dependencies, so every
 * caller of the one settle path (browser confirm, webhook, recovery job,
 * tick) lands contract payments the same way. */
export const CycleSettlementLive = Layer.effect(
  CycleSettlement,
  Effect.gen(function* () {
    const context = yield* Effect.context<ExtraSessionDeps>();
    return {
      settle: (row: Payment, now: Date) =>
        (row.kind === 'contract_extra_session'
          ? settleExtraSessionRow(row, now)
          : settleCycleRow(row, now)
        ).pipe(Effect.provide(context)),
      adopt: (row: Payment, fetched: ProviderPayment, now: Date) =>
        (row.kind === 'contract_extra_session'
          ? adoptExtraSessionPayment(row, fetched, now)
          : adoptProviderPayment(row, fetched, now)
        ).pipe(Effect.provide(context))
    };
  })
);
