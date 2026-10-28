import { daysBetween, todayIn } from '@repo/calendar';
import {
  DBNotFoundError as DBNotFoundErrorClass,
  EmptyContractRepoTest,
  EmptyUserProfileRepoTest,
  makeInMemoryBillingCustomerRepo,
  makeInMemoryContractBillingRepo,
  makeInMemoryPaymentRepo,
  makeInMemoryPayoutAccountRepo,
  makeInMemorySessionResolutionRepo,
  makeSeededTaxConfigRepo,
  makeUserRepoTest,
  BillingCustomerRepo,
  ContractBillingRepo,
  ContractRepo,
  PaymentRepo,
  liveBillingStatuses,
  type BillingLedgerInsert,
  type Contract,
  type ContractBilling,
  type ContractBillingInsert,
  type ContractCycle,
  type ContractCycleStatus,
  type ContractVersion,
  type Payment,
  type SessionRecord,
  type DBNotFoundError,
  PayoutAccountRepo,
  TaxConfigRepo,
  UserProfileRepo,
  UserRepo
} from '@repo/db';
import { Mailer, makeMailerTest } from '@repo/mail';
import { NoopNotificationHubTest, NotificationHub } from '@repo/notify';
import { contractBillingConfig } from '@repo/env';
import type { SqlError } from '@effect/sql/SqlError';
import {
  Payments,
  type ChargeSavedCardInput,
  type PaymentProviderError,
  type ProviderPayment
} from '@repo/payments';
import { Effect, Either, Layer } from 'effect';
import { CycleSettlement } from '../settle';
import { toCard } from '../cards';
import { paymentReadiness } from '../payouts';
import {
  MINIMUM_CHARGE_CENTS,
  quoteContractAmounts,
  type ContractAmounts,
  type ProvinceCode,
  type TaxLine
} from '../pricing';
import { loadTaxSnapshot } from '../tax';
import { alertAdmins, cycleDates, personName, sendBillingNotice } from './notices';
import {
  cycleIndexOf,
  DEFAULT_HOLD_LEAD_HOURS,
  planCycle,
  planWindow,
  type ScheduleTerms
} from './schedule';
import { effectiveEnd } from './terms';

/**
 * Contract billing (piece 3 spec §2–§5). One step per contract,
 * `runContractBilling(contractId, now)`, run by the worker's 15-minute tick
 * for every live contract, by the API right after acceptance (late
 * bookings) and after a card is replaced, and by the dev-only clock.
 *
 * Safe to run late, twice or concurrently: every write is a compare-and-set
 * on the row's status (and on the cycle's current attempt), every insert is
 * idempotent on its natural key, and every provider call carries a key
 * derived from the cycle id. Money is recorded only through `settlePayment`,
 * which re-fetches the payment from the provider and lands here in
 * `settleCyclePayment`.
 */

/** Everything a billing step reads and writes. */
export type BillingDeps =
  | ContractBillingRepo
  | ContractRepo
  | PaymentRepo
  | Payments
  | BillingCustomerRepo
  | PayoutAccountRepo
  | TaxConfigRepo
  | UserRepo
  | UserProfileRepo
  | Mailer
  | NotificationHub;

export type BillingError = SqlError | DBNotFoundError | PaymentProviderError;

type Step<A> = Effect.Effect<A, BillingError, BillingDeps>;

const HOUR_MS = 60 * 60 * 1000;

/** The commissions and the retry interval. A malformed setting fails loudly
 * (a defect, logged): billing at a wrong commission is worse than not
 * billing until the setting is fixed. Unset settings take their defaults. */
export const contractBillingPolicy = contractBillingConfig.pipe(
  Effect.tapError((error) =>
    Effect.logError('[billing] contract billing settings are invalid', error)
  ),
  Effect.orDie
);

/** How many declined recovery charges are tried after a system failure
 * before it is left to an admin (the incident is already open). */
const MAX_RECOVERY_DECLINES = 3;

/** Search is eventually consistent: an unanswered attempt is looked up only
 * once it is older than this. */
const LOOKUP_AFTER_MS = 2 * 60 * 1000;

/** The provider remembers an idempotency key for 24 h. Within this window
 * a replay of the create (same key, same request) is the authoritative
 * answer to "did it go through?"; past it, re-sending the request would be
 * a NEW charge, so the attempt is only ever looked up. */
const REPLAY_WINDOW_MS = 23 * HOUR_MS;

/** A search miss is evidence that nothing exists only once the attempt is
 * older than this (search lags behind creation, sometimes by minutes). */
const SEARCH_SETTLED_MS = HOUR_MS;

/** `payments.last_error` of an attempt the provider never answered and
 * that was found not to exist (or was released). */
const UNANSWERED = 'payment provider unavailable';

/** Cycles whose money is still in motion. */
const openCycleStatuses: ReadonlyArray<ContractCycleStatus> = [
  'scheduled',
  'authorising',
  'authorised',
  'grace',
  'capturing'
];

/** Cycles whose sessions are paid for (by the family, by the next cycle's
 * carry, or by Poppynz): they complete as they end. */
const fundedCycleStatuses: ReadonlyArray<ContractCycleStatus> = [
  'captured',
  'capture_failed',
  'empty',
  'carried'
];

const recoveryDeclines = (cycle: ContractCycle) =>
  cycle.noticesSent.filter((notice) => notice.startsWith('recovery_declined:')).length;

/** A system failure whose recovery from the family is still being tried. */
const recoveryPending = (cycle: ContractCycle) =>
  cycle.status === 'capture_failed' && recoveryDeclines(cycle) < MAX_RECOVERY_DECLINES;

export type BillingContext = {
  contract: Contract;
  accepted: ContractVersion;
  terms: ScheduleTerms;
};

// ---------------------------------------------------------------------------
// Context and amounts

const loadContext = (billing: ContractBilling) =>
  Effect.gen(function* () {
    const contracts = yield* ContractRepo;
    const contract = yield* contracts.findById(billing.contractId);
    if (!contract) return null;
    const versions = yield* contracts.listVersions(contract.id);
    const accepted = versions.find((version) => version.id === billing.acceptedVersionId);
    if (!accepted) return null;
    const end = effectiveEnd(contract, accepted);
    const { holdLeadHours, sessionWindowDays } = yield* contractBillingPolicy;
    const terms: ScheduleTerms = {
      services: accepted.services.map((service) => ({
        serviceId: service.serviceId,
        name: service.name,
        rateCents: service.rateCents,
        sessions: service.sessions
      })),
      startsOn: billing.startsOn,
      timeZone: billing.timeZone,
      endsOn: end?.endsOn ?? null,
      endsAtMinutes: end?.endsAtMinutes ?? null,
      // Only cycles planned from now on use it: a stored hold_at is never
      // recomputed (insertCycles keeps the row on file).
      holdLeadHours,
      sessionWindowDays
    };
    return { contract, accepted, terms } satisfies BillingContext;
  });

type Quote = { ok: true; amounts: ContractAmounts } | { ok: false; reason: string };

const quoteFor = (billing: ContractBilling, cycle: ContractCycle, serviceCents: number) =>
  Effect.gen(function* () {
    const snapshot = yield* loadTaxSnapshot;
    const quoted = quoteContractAmounts({
      serviceCents,
      familyFeeBps: billing.familyFeeBps,
      providerCommissionBps: billing.providerCommissionBps,
      snapshot,
      on: cycle.startsOn,
      familyProvince: billing.familyProvince as ProvinceCode,
      helperProvince: billing.helperProvince as ProvinceCode
    });
    return (
      quoted.ok
        ? { ok: true, amounts: quoted.amounts }
        : { ok: false, reason: `tax: ${quoted.error.reason} (${quoted.error.supplyType})` }
    ) as Quote;
  });

const allTaxLines = (amounts: ContractAmounts): Array<TaxLine> => [
  ...amounts.serviceTaxLines,
  ...amounts.familyFeeTaxLines,
  ...amounts.providerCommissionTaxLines
];

const sum = (lines: ReadonlyArray<TaxLine>) =>
  lines.reduce((total, line) => total + line.taxCents, 0);

/** The frozen quote, as cycle columns. */
const quoteColumns = (amounts: ContractAmounts) => ({
  serviceCents: amounts.serviceCents,
  serviceTaxCents: sum(amounts.serviceTaxLines),
  familyFeeBps: amounts.familyFeeBps,
  familyFeeCents: amounts.familyFeeCents,
  familyFeeTaxCents: sum(amounts.familyFeeTaxLines),
  familyTotalCents: amounts.familyTotalCents,
  providerCommissionBps: amounts.providerCommissionBps,
  providerCommissionCents: amounts.providerCommissionCents,
  providerCommissionTaxCents: sum(amounts.providerCommissionTaxLines),
  providerShareCents: amounts.providerShareCents,
  taxLines: allTaxLines(amounts).map((line) => ({ ...line }))
});

const billedSessions = (sessions: ReadonlyArray<SessionRecord>) =>
  sessions.filter((session) => session.status === 'scheduled' || session.status === 'completed');

const valueOf = (sessions: ReadonlyArray<SessionRecord>) =>
  sessions.reduce((total, session) => total + session.valueCents, 0);

// ---------------------------------------------------------------------------
// Materialisation and the effective end

const materialise = (billing: ContractBilling, terms: ScheduleTerms, today: string) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const plan = planWindow(terms, today, billing.materialisedThrough);
    if (plan.cycles.length > 0) {
      yield* repo.insertCycles(
        plan.cycles.map((cycle) => ({ ...cycle, contractId: billing.contractId }))
      );
    }
    if (plan.sessions.length > 0) {
      const cycles = yield* repo.listCycles(billing.contractId);
      const byIndex = new Map(cycles.map((cycle) => [cycle.index, cycle]));
      yield* repo.insertSessions(
        plan.sessions.flatMap((session) => {
          const cycle = byIndex.get(cycleIndexOf(terms, session.date));
          return cycle ? [{ ...session, contractId: billing.contractId, cycleId: cycle.id }] : [];
        })
      );
    }
    if (plan.through !== billing.materialisedThrough) {
      yield* repo.advanceBilling(billing.contractId, {
        from: liveBillingStatuses,
        set: { materialisedThrough: plan.through }
      });
    }
  });

/** Releases a hold best-effort; the provider expires it anyway. */
const releaseHold = (payment: Payment | null) =>
  Effect.gen(function* () {
    if (payment === null || payment.providerReference === null) return;
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    yield* payments
      .cancelPayment(payment.providerReference)
      .pipe(
        Effect.catchAll((error) => Effect.logWarning(`could not release hold ${payment.id}`, error))
      );
    yield* paymentRepo.advance(payment.id, {
      from: ['pending', 'authorised'],
      set: { status: 'failed', lastError: 'hold released', releasedAt: new Date() }
    });
  });

const findPayment = (paymentId: string | null) =>
  paymentId === null
    ? Effect.succeed(null)
    : PaymentRepo.pipe(
        Effect.flatMap((repo) => repo.findById(paymentId)),
        Effect.catchTag('DBNotFoundError', () => Effect.succeed(null))
      );

/** Notice given (or a negotiated end): nothing is billed past the last day. */
const applyEnd = (billing: ContractBilling, terms: ScheduleTerms) =>
  Effect.gen(function* () {
    if (terms.endsOn === null) return;
    const repo = yield* ContractBillingRepo;
    yield* repo.setSessionStatus(
      { contractId: billing.contractId, from: ['scheduled', 'suspended'], dateAfter: terms.endsOn },
      'cancelled'
    );
    for (const cycle of yield* repo.listCycles(billing.contractId)) {
      if (cycle.startsOn > terms.endsOn) {
        if (cycle.status === 'authorised') {
          const released = yield* repo.advanceCycle(cycle.id, {
            from: ['authorised'],
            set: { status: 'cancelled' }
          });
          if (released) {
            yield* releaseHold(yield* findPayment(cycle.paymentId));
            yield* repo.appendLedger([
              {
                contractId: cycle.contractId,
                cycleId: cycle.id,
                paymentId: cycle.paymentId,
                entryKey: `cycle:${cycle.id}:hold_released`,
                kind: 'hold_released',
                party: 'family',
                amountCents: cycle.heldCents ?? 0
              }
            ]);
          }
        } else if (cycle.status === 'scheduled' || cycle.status === 'grace') {
          yield* repo.advanceCycle(cycle.id, {
            from: [cycle.status],
            set: { status: 'cancelled' }
          });
        }
      } else if (cycle.endsOn > terms.endsOn && cycle.status === 'scheduled') {
        // The new last cycle: its instants follow its shortened dates.
        const replanned = planCycle(terms, cycle.index);
        if (replanned) {
          yield* repo.advanceCycle(cycle.id, {
            from: ['scheduled'],
            set: {
              endsOn: replanned.endsOn,
              endsAt: replanned.endsAt,
              captureAt: replanned.captureAt,
              transferAt: replanned.transferAt
            }
          });
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// Suspension and notices

/** Records a notice once, atomically: null when it was already recorded
 * (by this or a concurrent caller), so it is sent exactly once. */
const markNotice = (cycle: ContractCycle, notice: string) =>
  ContractBillingRepo.pipe(Effect.flatMap((repo) => repo.appendCycleNotice(cycle.id, notice)));

/** Unfunded at the cycle start (or the hold released for a helper who is no
 * longer payment-ready): the cycle and its sessions are suspended and never
 * billed; the contract is suspended until the cause is fixed. */
const suspendCycle = (
  ctx: BillingContext,
  cycle: ContractCycle,
  reason: 'card' | 'helper_not_ready' | 'provider_unavailable',
  from: ReadonlyArray<ContractCycleStatus>,
  now: Date,
  lastError: string | null = null
) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const moved = yield* repo.advanceCycle(cycle.id, {
      from,
      set: { status: 'suspended', suspendedAt: now, nextRetryAt: null, lastError }
    });
    if (!moved) return null;
    yield* repo.setSessionStatus(
      { contractId: cycle.contractId, cycleId: cycle.id, from: ['scheduled'] },
      'suspended'
    );
    yield* repo.advanceBilling(cycle.contractId, {
      from: ['scheduled', 'active'],
      set: { status: 'suspended', suspendedReason: reason, suspendedAt: now }
    });
    const parties = reason === 'card' ? (['helper', 'family'] as const) : (['helper'] as const);
    yield* sendBillingNotice('suspended', parties, { contract: ctx.contract, cycle: moved });
    if (reason !== 'card') {
      yield* alertAdmins(`Contract ${cycle.contractId} suspended (${reason})`, [
        `Cycle ${cycle.index + 1} (${cycleDates(cycle)}) could not be funded before it started.`,
        `Reason: ${reason}${lastError ? ` — ${lastError}` : ''}.`,
        'No unfunded care starts: the helper has been told not to work these dates.'
      ]);
    }
    return moved;
  });

/** Once per cycle: the helper's payout account isn't ready, so no hold. */
const noticeHelperNotReady = (ctx: BillingContext, cycle: ContractCycle) =>
  Effect.gen(function* () {
    if (cycle.noticesSent.includes('helper_not_ready')) return;
    const marked = yield* markNotice(cycle, 'helper_not_ready');
    if (!marked) return;
    yield* sendBillingNotice('helper_not_ready', ['helper', 'family'], {
      contract: ctx.contract,
      cycle
    });
    yield* alertAdmins(`Helper not payment-ready on contract ${cycle.contractId}`, [
      `Cycle ${cycle.index + 1} (${cycleDates(cycle)}) can't be held: the helper's payout account isn't ready.`,
      "The family's card is not charged; the cycle is suspended if this lasts until it starts."
    ]);
  });

/** The helper's payout status could not be confirmed (Stripe unreachable,
 * or only stale data on file): nothing is held, captured, released,
 * suspended or cancelled on it — the next tick asks again. Once the cycle
 * has started this way an admin is told, once. */
const readinessUnknown = (ctx: BillingContext, cycle: ContractCycle, now: Date) =>
  Effect.gen(function* () {
    yield* Effect.logWarning(
      `[billing] payout readiness unknown for cycle ${cycle.id}; retrying next tick`
    );
    if (now < cycle.startsAt) return;
    const marked = yield* markNotice(cycle, 'readiness_unknown');
    if (!marked) return;
    yield* alertAdmins(`Helper payout readiness unknown on contract ${ctx.contract.id}`, [
      `Cycle ${cycle.index + 1} (${cycleDates(cycle)}) has started, but the helper's payout account status could not be confirmed with Stripe.`,
      'Nothing was held, captured or released on an unconfirmed status; billing retries every tick.'
    ]);
  });

// ---------------------------------------------------------------------------
// Charging

type ChargeMode = 'hold' | 'immediate' | 'resume';

/** "Care with Sam T. · Mon, Nov 2 – Wed, Nov 4" */
const describeCycle = (ctx: BillingContext, cycle: ContractCycle, mode: ChargeMode) =>
  Effect.gen(function* () {
    const helper = yield* personName(ctx.contract.providerUserId);
    const label =
      mode !== 'resume'
        ? 'Care'
        : cycle.status === 'capture_failed'
          ? 'Care (recovery)'
          : 'Care (resumed)';
    return `${label} with ${helper.name} · ${cycleDates(cycle)}`;
  });

/** The idempotency key of a cycle's next attempt (`cycle.attempts + 1`). */
const attemptKey = (cycle: ContractCycle, mode: ChargeMode, attemptNumber: number) =>
  `${mode === 'resume' && cycle.status === 'capture_failed' ? 'recover' : 'cycle'}-${cycle.id}-${attemptNumber}`;

/** The one request an attempt is ever sent as: its own card and key, frozen
 * on the row when it was created (R4) — so a retry or a replay is the same
 * request even after the family replaces the card. Rows from before that
 * fall back to the card on file and the key derived from the cycle. Null
 * when there is no card to charge. */
const chargeRequest = (cycle: ContractCycle, payment: Payment) =>
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
      capture: cycle.chargeMode === 'hold' ? 'manual' : 'automatic',
      idempotencyKey:
        payment.chargeKey ?? attemptKey(cycle, cycle.chargeMode ?? 'hold', cycle.attempts),
      metadata: {
        payment_id: payment.id,
        cycle_id: cycle.id,
        contract_id: cycle.contractId,
        kind: 'contract_cycle'
      },
      ...(payment.description ? { description: payment.description } : {})
    } satisfies ChargeSavedCardInput as ChargeSavedCardInput;
  });

/** Calls the provider for the cycle's current attempt and settles what it
 * says. A provider error leaves the attempt pending: the next tick retries
 * it under the same key, so it can never become a second charge. A key the
 * provider refuses (`conflict`) is resolved by the caller, never re-sent. */
const chargeAndSettle = (
  cycle: ContractCycle,
  payment: Payment,
  now: Date
): Step<'provider_error' | 'settled' | 'declined' | 'conflict'> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ContractBillingRepo;
    const paymentRepo = yield* PaymentRepo;
    const request = yield* chargeRequest(cycle, payment);
    if (request === null) {
      const failed =
        (yield* paymentRepo.advance(payment.id, {
          from: 'pending',
          set: { status: 'failed', lastError: 'There is no card on file.' }
        })) ?? payment;
      return yield* declined(cycle, failed, 'There is no card on file.', now);
    }
    const result = yield* payments.chargeSavedCard(request).pipe(Effect.either);
    if (Either.isLeft(result)) {
      yield* Effect.logWarning(`[billing] provider error charging cycle ${cycle.id}`, result.left);
      if (result.left.idempotency === 'mismatch') return 'conflict' as const;
      yield* repo.advanceCycle(cycle.id, {
        from: [cycle.status],
        paymentId: payment.id,
        set: { lastError: 'payment provider unavailable — retrying' }
      });
      return 'provider_error' as const;
    }
    yield* paymentRepo.advance(payment.id, {
      from: 'pending',
      providerReference: null,
      set: { providerReference: result.right.reference }
    });
    yield* settleCycleRow(yield* paymentRepo.findById(payment.id), now, result.right);
    return 'settled' as const;
  });

// ---------------------------------------------------------------------------
// Attempts the provider never answered (M4)

type Lookup =
  | { kind: 'found'; payment: ProviderPayment }
  | { kind: 'none' }
  | { kind: 'unknown' };

/** What became of an unanswered attempt at the provider. Asked before the
 * attempt is given up or replaced, so a charge whose response was lost is
 * never orphaned (R3):
 *
 *   1. Within the provider's key window, the create is REPLAYED — same key,
 *      same request. That answer is authoritative: the first response if
 *      the request ever got through, otherwise the request now (which is
 *      what a retry would have done anyway).
 *   2. Otherwise, or when the replay can't be made or answered, search.
 *   3. A search miss counts as "nothing exists" only once the attempt is
 *      older than `SEARCH_SETTLED_MS`; before that it is "unknown". */
const resolveAttempt = (cycle: ContractCycle, payment: Payment, now: Date): Step<Lookup> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const age = now.getTime() - payment.createdAt.getTime();
    if (age < REPLAY_WINDOW_MS && cycle.paymentId === payment.id) {
      const request = yield* chargeRequest(cycle, payment);
      if (request !== null) {
        const replayed = yield* payments.chargeSavedCard(request).pipe(Effect.either);
        if (Either.isRight(replayed)) {
          return { kind: 'found', payment: replayed.right } as Lookup;
        }
        yield* Effect.logWarning(`[billing] could not replay payment ${payment.id}`, replayed.left);
      }
    }
    const found = yield* payments.findPaymentByRowId(payment.id).pipe(Effect.either);
    if (Either.isLeft(found)) {
      yield* Effect.logWarning(`[billing] could not look up payment ${payment.id}`, found.left);
      return { kind: 'unknown' } as Lookup;
    }
    if (found.right !== null) return { kind: 'found', payment: found.right } as Lookup;
    return (age >= SEARCH_SETTLED_MS ? { kind: 'none' } : { kind: 'unknown' }) as Lookup;
  });

/** Ends an unanswered attempt that must not be used any more (a stale
 * resume quote, a cycle that started unfunded): whatever the provider has
 * for it is cancelled — or refunded, when it was taken — and the row is
 * failed (or refunded). Resolves false while the provider can't be asked. */
const releaseUnanswered = (cycle: ContractCycle, payment: Payment, now: Date): Step<boolean> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const found = yield* resolveAttempt(cycle, payment, now);
    if (found.kind === 'unknown') {
      yield* paymentRepo.update(payment.id, {
        lastError: 'unanswered by the provider — looking it up'
      });
      return false;
    }
    if (found.kind === 'none') {
      yield* paymentRepo.advance(payment.id, {
        from: 'pending',
        providerReference: null,
        set: { status: 'failed', lastError: UNANSWERED }
      });
      return true;
    }
    const reference = found.payment.reference;
    const after =
      found.payment.status === 'succeeded'
        ? found.payment
        : yield* payments.cancelPayment(reference).pipe(Effect.either).pipe(
            Effect.map((either) => (Either.isRight(either) ? either.right : null))
          );
    if (after === null) return false;
    if (after.status === 'succeeded') {
      const refund = yield* payments
        .refund({ reference, reason: 'unanswered contract charge', idempotencyKey: `unanswered-${payment.id}` })
        .pipe(Effect.either);
      if (Either.isLeft(refund)) {
        yield* paymentRepo.update(payment.id, {
          providerReference: reference,
          lastError: 'unanswered charge was taken; refund failed — retrying'
        });
        return false;
      }
      yield* paymentRepo.advance(payment.id, {
        from: ['pending', 'authorised', 'captured'],
        set: {
          status: 'refunded',
          providerReference: reference,
          refundReference: refund.right.refundReference,
          refundedAt: refund.right.refundedAt,
          lastError: 'unanswered charge refunded'
        }
      });
      return true;
    }
    yield* paymentRepo.advance(payment.id, {
      from: ['pending', 'authorised'],
      set: {
        status: 'failed',
        providerReference: reference,
        lastError: UNANSWERED,
        ...(found.payment.status === 'authorised' ? { releasedAt: now } : {})
      }
    });
    return true;
  });

/** Not yet answered and old enough to look up. */
const isUnanswered = (payment: Payment | null, now: Date): payment is Payment =>
  payment !== null &&
  payment.status === 'pending' &&
  payment.providerReference === null &&
  now.getTime() - payment.createdAt.getTime() >= LOOKUP_AFTER_MS;

/** Starts a new attempt for a cycle: a payment row first (its breakdown is
 * frozen there), then the cycle claimed for it by compare-and-set on its
 * status AND its attempt counter, so two callers holding the same snapshot
 * (card confirm and webhook) can never share an attempt key. */
const attempt = (
  ctx: BillingContext,
  cycle: ContractCycle,
  mode: ChargeMode,
  amounts: ContractAmounts,
  from: ReadonlyArray<ContractCycleStatus>,
  now: Date
): Step<'lost' | 'provider_error' | 'settled' | 'declined' | 'conflict'> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const repo = yield* ContractBillingRepo;
    // The previous attempt was never answered: settle what became of it
    // before a new one can replace it on the cycle.
    const previous = yield* findPayment(cycle.paymentId);
    if (previous !== null && previous.status === 'pending' && previous.providerReference === null) {
      if (!isUnanswered(previous, now)) return 'provider_error' as const;
      if (!(yield* releaseUnanswered(cycle, previous, now))) return 'provider_error' as const;
    }
    const description = yield* describeCycle(ctx, cycle, mode);
    // The card and key are frozen on the row: this attempt is only ever
    // sent as this one request (R4).
    const customer = yield* (yield* BillingCustomerRepo).findByUserId(ctx.contract.familyUserId);
    const card = toCard(customer, payments.provider);
    const payment = yield* paymentRepo.create({
      userId: ctx.contract.familyUserId,
      kind: 'contract_cycle',
      provider: payments.provider,
      amountCents: amounts.serviceCents,
      feeCents: amounts.familyFeeCents,
      taxCents: sum(amounts.serviceTaxLines) + sum(amounts.familyFeeTaxLines),
      totalCents: amounts.familyTotalCents,
      taxLines: [...amounts.serviceTaxLines, ...amounts.familyFeeTaxLines].map((line) => ({
        ...line
      })),
      description,
      cardReference: card?.reference ?? null,
      chargeKey: attemptKey(cycle, mode, cycle.attempts + 1)
    });
    const claimed = yield* repo.advanceCycle(cycle.id, {
      from,
      attempts: cycle.attempts,
      set: {
        ...(cycle.status === 'capture_failed' ? {} : { status: 'authorising' as const }),
        chargeMode: mode,
        ...(mode === 'resume' && cycle.status !== 'capture_failed' ? { resumeFrom: now } : {}),
        attempts: cycle.attempts + 1,
        paymentId: payment.id,
        nextRetryAt: null,
        lastError: null,
        ...(cycle.status === 'capture_failed' ? {} : quoteColumns(amounts))
      }
    });
    if (!claimed) {
      yield* paymentRepo.advance(payment.id, {
        from: 'pending',
        set: { status: 'failed', lastError: 'superseded by a concurrent attempt' }
      });
      return 'lost' as const;
    }
    return yield* chargeAndSettle(claimed, payment, now);
  });

/** Holds (or charges) a cycle that is due. */
const fund = (
  billing: ContractBilling,
  ctx: BillingContext,
  cycle: ContractCycle,
  from: ReadonlyArray<ContractCycleStatus>,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    // Pre-cycle recheck and the readiness gate: no hold on the family's card
    // while the helper can't be paid — and nothing at all on a status that
    // could not be confirmed.
    const readiness = yield* paymentReadiness(ctx.contract.providerUserId);
    if (readiness === 'unknown') return yield* readinessUnknown(ctx, cycle, now);
    if (readiness === 'not_ready') {
      yield* noticeHelperNotReady(ctx, cycle);
      if (now >= cycle.startsAt) {
        yield* suspendCycle(ctx, cycle, 'helper_not_ready', from, now);
      }
      return;
    }
    const sessions = yield* repo.listSessions(cycle.contractId, cycle.id);
    const billed = billedSessions(sessions);
    const quote = yield* quoteFor(billing, cycle, valueOf(billed) + cycle.carriedInCents);
    if (!quote.ok) {
      // A Poppynz configuration failure, never the family's: alert, and
      // never let the cycle start unfunded.
      if (!cycle.noticesSent.includes('quote_failed')) {
        const marked = yield* markNotice(cycle, 'quote_failed');
        if (marked) {
          yield* alertAdmins(`Contract ${cycle.contractId} cannot be priced`, [
            `Cycle ${cycle.index + 1} (${cycleDates(cycle)}): ${quote.reason}.`,
            'Fix the tax configuration; billing retries every tick.'
          ]);
        }
      }
      if (now >= cycle.startsAt) {
        yield* suspendCycle(ctx, cycle, 'provider_unavailable', from, now, quote.reason);
      }
      return;
    }
    const amounts = quote.amounts;
    if (amounts.familyTotalCents === 0) {
      yield* repo.advanceCycle(cycle.id, {
        from,
        set: { status: 'empty', ...quoteColumns(amounts) }
      });
      return;
    }
    if (amounts.familyTotalCents < MINIMUM_CHARGE_CENTS) {
      return yield* carry(cycle, amounts, from);
    }
    const first = billed[0]?.startsAt ?? null;
    // A late booking: billable only after this cycle's hold time, and less
    // than the hold lead before its first session — there is no time for a
    // grace period, so it is charged at once (umbrella §6).
    const lateBookingMs = (ctx.terms.holdLeadHours ?? DEFAULT_HOLD_LEAD_HOURS) * HOUR_MS;
    const late =
      cycle.attempts === 0 &&
      billing.billableFrom !== null &&
      billing.billableFrom > cycle.holdAt &&
      first !== null &&
      first.getTime() - billing.billableFrom.getTime() < lateBookingMs;
    const mode: ChargeMode = late || now >= cycle.captureAt ? 'immediate' : 'hold';
    return yield* attempt(ctx, cycle, mode, amounts, from, now);
  });

/** Under the provider's minimum: the service value rolls into the next
 * cycle; with no next cycle Poppynz absorbs it (umbrella §6). */
const carry = (
  cycle: ContractCycle,
  amounts: ContractAmounts,
  from: ReadonlyArray<ContractCycleStatus>
) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const carried = yield* repo.advanceCycle(cycle.id, {
      from,
      set: { status: 'carried', carriedOutCents: amounts.serviceCents, ...quoteColumns(amounts) }
    });
    if (!carried) return;
    const next = (yield* repo.listCycles(cycle.contractId)).find(
      (c) => c.index === cycle.index + 1
    );
    const forwarded =
      next && next.status === 'scheduled'
        ? yield* repo.advanceCycle(next.id, {
            from: ['scheduled'],
            set: { carriedInCents: next.carriedInCents + amounts.serviceCents }
          })
        : null;
    const entries: Array<BillingLedgerInsert> = [
      {
        contractId: cycle.contractId,
        cycleId: cycle.id,
        entryKey: `cycle:${cycle.id}:carry_forward`,
        kind: 'carry_forward',
        party: 'family',
        amountCents: amounts.serviceCents
      }
    ];
    if (!forwarded) {
      entries.push({
        contractId: cycle.contractId,
        cycleId: cycle.id,
        entryKey: `cycle:${cycle.id}:carry_absorbed`,
        kind: 'carry_absorbed',
        party: 'platform',
        amountCents: amounts.familyTotalCents
      });
    }
    yield* repo.appendLedger(entries);
  });

/** The payment row carries what is captured, so the payer's history and the
 * tax collected add up: its breakdown follows the cycle's (re)quote — its
 * total stays the authorised amount the provider holds; `captured_cents` is
 * what was taken. Idempotent, so a crash between claiming the capture and
 * this write is repaired by running it again (M6). */
const syncCaptureBreakdown = (cycle: ContractCycle, payment: Payment) =>
  Effect.gen(function* () {
    if (cycle.serviceCents === null || cycle.familyFeeCents === null) return payment;
    const taxLines = cycle.taxLines.filter(
      (line) =>
        line.supplyType === 'care_service_value' || line.supplyType === 'family_service_fee'
    );
    const breakdown = {
      amountCents: cycle.serviceCents,
      feeCents: cycle.familyFeeCents,
      taxCents: sum(taxLines as ReadonlyArray<TaxLine>),
      taxLines: taxLines.map((line) => ({ ...line }))
    };
    if (
      payment.amountCents === breakdown.amountCents &&
      payment.feeCents === breakdown.feeCents &&
      payment.taxCents === breakdown.taxCents &&
      JSON.stringify(payment.taxLines) === JSON.stringify(breakdown.taxLines)
    ) {
      return payment;
    }
    return yield* (yield* PaymentRepo).update(payment.id, breakdown);
  });

/** A held cycle is due for capture: recheck the helper, then capture what
 * its sessions are worth now (never more than the hold). */
const capture = (billing: ContractBilling, ctx: BillingContext, cycle: ContractCycle, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const payment = yield* findPayment(cycle.paymentId);
    if (payment === null || payment.providerReference === null) return;
    const readiness = yield* paymentReadiness(ctx.contract.providerUserId);
    // A status that can't be confirmed never releases a valid hold.
    if (readiness === 'unknown') return yield* readinessUnknown(ctx, cycle, now);
    if (readiness === 'not_ready') {
      // The pre-cycle recheck failed: never capture money that can't reach
      // the helper. Suspended first, so the released hold can't be mistaken
      // for a system failure, then released.
      yield* noticeHelperNotReady(ctx, cycle);
      const suspended = yield* suspendCycle(
        ctx,
        cycle,
        'helper_not_ready',
        ['authorised'],
        now,
        'helper not payment-ready at capture'
      );
      if (suspended) {
        yield* releaseHold(payment);
        yield* repo.appendLedger([
          {
            contractId: cycle.contractId,
            cycleId: cycle.id,
            paymentId: payment.id,
            entryKey: `cycle:${cycle.id}:hold_released`,
            kind: 'hold_released',
            party: 'family',
            amountCents: cycle.heldCents ?? payment.totalCents
          }
        ]);
      }
      return;
    }
    const billed = billedSessions(yield* repo.listSessions(cycle.contractId, cycle.id));
    const quote = yield* quoteFor(billing, cycle, valueOf(billed) + cycle.carriedInCents);
    const held = cycle.heldCents ?? payment.totalCents;
    const amounts = quote.ok ? quote.amounts : null;
    if (amounts !== null && amounts.familyTotalCents === 0) {
      const emptied = yield* repo.advanceCycle(cycle.id, {
        from: ['authorised'],
        set: { status: 'empty', ...quoteColumns(amounts) }
      });
      if (emptied) yield* releaseHold(payment);
      return;
    }
    // Sessions removed since the hold reduce what is captured; a quote
    // failure now captures the hold as quoted.
    const requoted = amounts !== null && amounts.familyTotalCents <= held ? amounts : null;
    const claimed = yield* repo.advanceCycle(cycle.id, {
      from: ['authorised'],
      set: { status: 'capturing', ...(requoted ? quoteColumns(requoted) : {}) }
    });
    if (!claimed) return;
    // A crash before this write is repaired by the `capturing` branch.
    yield* captureClaimed(ctx, claimed, yield* syncCaptureBreakdown(claimed, payment), now);
  });

/** Captures a claimed cycle under its one key (`capture-<cycleId>`). A
 * provider error is not a refusal: the provider is asked what became of the
 * hold — a lost response may have captured it — and while the hold stands
 * the next tick retries under the same key. Only a hold that can no longer
 * be captured is a system failure. */
const captureClaimed = (
  ctx: BillingContext,
  cycle: ContractCycle,
  payment: Payment,
  now: Date
): Step<void> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ContractBillingRepo;
    const paymentRepo = yield* PaymentRepo;
    const reference = payment.providerReference!;
    const amount = Math.min(
      cycle.familyTotalCents ?? payment.totalCents,
      cycle.heldCents ?? payment.totalCents
    );
    const result = yield* payments
      .capturePayment({ reference, amountCents: amount, idempotencyKey: cycle.id })
      .pipe(Effect.either);
    if (Either.isRight(result)) {
      yield* settleCycleRow(yield* paymentRepo.findById(payment.id), now, result.right);
      return;
    }
    yield* Effect.logWarning(`[billing] capture failed for cycle ${cycle.id}`, result.left);
    const retry = (lastError: string) =>
      repo
        .advanceCycle(cycle.id, { from: ['capturing'], set: { lastError } })
        .pipe(Effect.asVoid);
    const fetched = yield* payments.getPayment(reference).pipe(Effect.either);
    if (Either.isLeft(fetched)) return yield* retry('capture failed at the provider — retrying');
    const row = yield* paymentRepo.findById(payment.id);
    switch (fetched.right.status) {
      case 'succeeded':
      case 'canceled':
        // Captured after all (a lost response), or the hold is gone (the
        // settle path records the system failure).
        yield* settleCycleRow(row, now, fetched.right);
        return;
      case 'authorised':
      case 'processing':
        // The hold stands: same key on the next tick.
        return yield* retry('capture failed at the provider — retrying');
      default: {
        // Refused for good: represented as funded, yet nothing can be
        // captured — a system failure.
        yield* paymentRepo.advance(payment.id, {
          from: ['authorised'],
          set: { status: 'failed', lastError: 'the provider refused to capture the hold' }
        });
        const failed = yield* repo.advanceCycle(cycle.id, {
          from: ['capturing'],
          set: { status: 'capture_failed', lastError: 'the provider refused to capture the hold' }
        });
        if (failed) yield* systemFailure(ctx, failed, 'the provider refused to capture the hold', now);
      }
    }
  });

/** Settles an attempt by re-fetching it; a provider that can't be reached
 * leaves it for the next tick. */
const settleQuietly = (payment: Payment, now: Date) =>
  settleCycleRow(payment, now).pipe(
    Effect.catchTag('PaymentProviderError', (error) =>
      Effect.logWarning(`[billing] could not re-fetch payment ${payment.id}`, error).pipe(
        Effect.as(null)
      )
    )
  );

/** An attempt that was never answered, at the cycle start: whatever the
 * provider has for it is used (a hold or charge whose response was lost);
 * without one the cycle is suspended — not the card's fault. When the
 * provider can't say yet (unreachable, or a search miss on a young attempt)
 * the cycle is suspended all the same and the attempt stays pending, to be
 * resolved on later ticks (`resolveStrandedAttempts`) — never failed on a
 * guess, which would orphan a charge that did go through. */
const giveUpAtStart = (ctx: BillingContext, cycle: ContractCycle, payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const found = yield* resolveAttempt(cycle, payment, now);
    if (found.kind === 'found') {
      yield* adoptProviderPayment(payment, found.payment, now);
      return;
    }
    if (found.kind === 'none') {
      yield* paymentRepo.advance(payment.id, {
        from: 'pending',
        providerReference: null,
        set: { status: 'failed', lastError: UNANSWERED }
      });
    } else {
      yield* paymentRepo.update(payment.id, {
        lastError: 'unanswered by the provider — looking it up'
      });
    }
    yield* suspendCycle(ctx, cycle, 'provider_unavailable', ['authorising'], now, UNANSWERED);
  });

/** A resume quote counts only for sessions that have not started: once its
 * first session has, it is stale. */
const resumeQuoteStale = (cycle: ContractCycle, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const from = cycle.resumeFrom ?? new Date(0);
    const quoted = (yield* repo.listSessions(cycle.contractId, cycle.id)).filter(
      (session) => session.status === 'suspended' && session.startsAt > from
    );
    return quoted.length === 0 || quoted.some((session) => session.startsAt <= now);
  });

/** A resume charge the provider never answered, whose quote went stale:
 * whatever exists for it is released, the cycle goes back to suspended and
 * the next tick re-quotes what is left (the provider was the cause, so the
 * tick resumes by itself). */
const giveUpResume = (cycle: ContractCycle, payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    // Unresolved (unknown) leaves the row pending for resolveStrandedAttempts.
    yield* releaseUnanswered(cycle, payment, now);
    const back = yield* repo.advanceCycle(cycle.id, {
      from: ['authorising'],
      paymentId: payment.id,
      set: { status: 'suspended', lastError: 'resume charge unanswered — re-quoting' }
    });
    if (back) {
      yield* repo.advanceBilling(cycle.contractId, {
        from: ['suspended'],
        set: { suspendedReason: 'provider_unavailable' }
      });
    }
  });

/** An unanswered attempt, before its give-up point: re-sent as the very
 * same request (a replay — never a second charge) while that is still safe
 * and still right. It is resolved at the provider instead when the family
 * has replaced the card since, when the provider refuses the key, or once
 * the provider has forgotten the key (re-sending would then be a NEW
 * charge). Found → adopted; nothing there → failed and a new attempt starts
 * at once with a new key and the card on file now (R4); unknown → asked
 * again next tick. */
const retryUnanswered = (
  billing: ContractBilling,
  ctx: BillingContext,
  cycle: ContractCycle,
  payment: Payment,
  now: Date
): Step<void> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const onFile = toCard(
      yield* (yield* BillingCustomerRepo).findByUserId(payment.userId),
      payments.provider
    );
    const replaced = payment.cardReference !== null && onFile?.reference !== payment.cardReference;
    const age = now.getTime() - payment.createdAt.getTime();
    if (age < REPLAY_WINDOW_MS && !replaced) {
      if ((yield* chargeAndSettle(cycle, payment, now)) !== 'conflict') return;
    }
    const found = yield* resolveAttempt(cycle, payment, now);
    if (found.kind === 'found') {
      yield* adoptProviderPayment(payment, found.payment, now);
      return;
    }
    if (found.kind === 'unknown') {
      yield* paymentRepo.update(payment.id, {
        lastError: 'unanswered by the provider — looking it up'
      });
      return;
    }
    const failed = yield* paymentRepo.advance(payment.id, {
      from: 'pending',
      providerReference: null,
      set: { status: 'failed', lastError: UNANSWERED }
    });
    if (failed) yield* startOver(billing, ctx, cycle, failed, now);
  });

/** The cycle's unanswered attempt was resolved as never having reached the
 * provider: a new attempt starts now, as it would have after a decline that
 * was nobody's fault — without the retry wait. */
const startOver = (
  billing: ContractBilling,
  ctx: BillingContext,
  cycle: ContractCycle,
  failed: Payment,
  now: Date
): Step<void> =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    if (cycle.status === 'capture_failed') {
      const fresh = (yield* repo.listCycles(cycle.contractId)).find((row) => row.id === cycle.id);
      if (fresh && recoveryPending(fresh)) yield* recover(ctx, fresh, now);
      return;
    }
    if (cycle.chargeMode === 'resume') {
      // Back to suspended (the provider's fault); resume re-quotes the rest.
      yield* providerSideFailure(cycle, failed, UNANSWERED, now);
      const current = yield* repo.findBilling(cycle.contractId);
      if (current) yield* resume(current, ctx, now, 'tick');
      return;
    }
    const graced = yield* repo.advanceCycle(cycle.id, {
      from: ['authorising'],
      paymentId: failed.id,
      set: { status: 'grace', nextRetryAt: now, lastError: UNANSWERED }
    });
    if (graced) yield* fund(billing, ctx, graced, ['grace'], now);
  });

// ---------------------------------------------------------------------------
// Provider payments found by our payment id (webhook fallback, lookups)

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)} CAD`;

/** A provider payment for an attempt that was given up (failed, refunded,
 * superseded) or that belongs to a row holding another intent: nothing
 * may be kept. A hold is cancelled, a charge refunded — automatically —
 * and an admin incident raised once per provider payment. Fails (so the
 * webhook is retried) while the provider can't be reached. */
const releaseOrphan = (row: Payment, fetched: ProviderPayment, now: Date) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const repo = yield* ContractBillingRepo;
    if (fetched.status === 'canceled') {
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    if (fetched.status === 'succeeded' && fetched.refundedCents > 0) {
      // Already given back (by an earlier delivery or by hand).
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    const after =
      fetched.status === 'succeeded' ? fetched : yield* payments.cancelPayment(fetched.reference);
    const refund =
      after.status === 'succeeded'
        ? yield* payments.refund({
            reference: fetched.reference,
            reason: 'charge on a contract attempt that was given up',
            idempotencyKey: `orphan-${fetched.reference}`
          })
        : null;
    // A row that never learned its intent records it (so later events find
    // it, and the payer's history shows the refund or the release).
    const recorded =
      row.providerReference !== null
        ? row
        : ((yield* paymentRepo.advance(row.id, {
            from: ['failed', 'refunded'],
            providerReference: null,
            set: refund
              ? {
                  status: 'refunded',
                  providerReference: fetched.reference,
                  refundReference: refund.refundReference,
                  refundedAt: refund.refundedAt,
                  lastError: 'charge landed after the attempt was given up — refunded'
                }
              : {
                  providerReference: fetched.reference,
                  releasedAt: now,
                  lastError: 'hold landed after the attempt was given up — released'
                }
          })) ?? row);
    const contractId = fetched.metadata.contract_id ?? null;
    const cycle =
      (contractId === null
        ? null
        : (yield* repo.listCycles(contractId)).find(
            (candidate) => candidate.id === fetched.metadata.cycle_id
          )) ?? (yield* repo.findCycleByPaymentId(row.id));
    const what = refund ? 'charge' : 'hold';
    const detail = `A ${what} of ${dollars(fetched.amountCents)} (${fetched.reference}) landed on payment ${row.id} after that attempt was given up; it was ${refund ? 'refunded' : 'released'} automatically`;
    const first =
      cycle === null
        ? true
        : yield* repo.recordIncident({
            contractId: cycle.contractId,
            cycleId: cycle.id,
            kind: `orphaned_payment:${fetched.reference}`,
            detail
          });
    if (first) {
      yield* alertAdmins(
        `Payment landed on a given-up attempt${cycle ? ` on contract ${cycle.contractId}` : ''}`,
        [
          `${detail}.`,
          cycle
            ? `Cycle ${cycle.index + 1} (${cycleDates(cycle)}) is billed by its own current attempt; the family was not charged twice.`
            : 'No cycle could be matched: check the payment by hand.'
        ]
      );
    }
    return { outcome: 'released' as CycleSettleOutcome, payment: recorded };
  });

/** A provider payment that names our row (`metadata.payment_id`) — from a
 * lookup, or a webhook whose reference matched no row (the response was
 * lost, so the row never learned it). An unanswered row adopts it and
 * settles it the normal way; a row that has moved on (given up, or holding
 * another intent) never keeps it: it is released (R3). */
export const adoptProviderPayment = (
  row: Payment,
  fetched: ProviderPayment,
  now: Date
): Step<{ outcome: CycleSettleOutcome; payment: Payment }> =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    if (fetched.metadata.payment_id !== row.id) {
      return { outcome: 'mismatch' as CycleSettleOutcome, payment: row };
    }
    const current =
      row.status === 'pending' && row.providerReference === null
        ? ((yield* paymentRepo.advance(row.id, {
            from: 'pending',
            providerReference: null,
            set: { providerReference: fetched.reference }
          })) ?? (yield* paymentRepo.findById(row.id)))
        : row;
    const live =
      current.status === 'pending' || current.status === 'authorised' || current.status === 'captured';
    if (live && current.providerReference === fetched.reference) {
      return yield* settleCycleRow(current, now, fetched);
    }
    return yield* releaseOrphan(current, fetched, now);
  });

// ---------------------------------------------------------------------------
// One cycle, by status

const processCycle = (
  billing: ContractBilling,
  ctx: BillingContext,
  cycle: ContractCycle,
  now: Date
) =>
  Effect.gen(function* () {
    const { retryHours } = yield* contractBillingPolicy;
    switch (cycle.status) {
      case 'scheduled': {
        if (billing.status === 'suspended') {
          // No hold while the contract is suspended; a cycle that starts
          // meanwhile is suspended too.
          if (now >= cycle.startsAt) {
            yield* suspendCycle(ctx, cycle, billing.suspendedReason ?? 'card', ['scheduled'], now);
          }
          return;
        }
        if (billing.status !== 'scheduled' && billing.status !== 'active') return;
        if (now < cycle.holdAt) return;
        return yield* fund(billing, ctx, cycle, ['scheduled'], now);
      }
      case 'grace': {
        if (now >= cycle.startsAt) {
          return yield* suspendCycle(ctx, cycle, 'card', ['grace'], now, cycle.lastError);
        }
        const due = cycle.nextRetryAt ?? new Date(cycle.updatedAt.getTime() + retryHours * HOUR_MS);
        if (now < due) return;
        return yield* fund(billing, ctx, cycle, ['grace'], now);
      }
      case 'authorising': {
    const payment = yield* findPayment(cycle.paymentId);
        if (payment === null) return;
        if (payment.status === 'pending' && payment.providerReference === null) {
          // The provider never answered this attempt. Retry under the same
          // key while the quote still holds; then resolve it at the provider.
          if (cycle.chargeMode === 'resume') {
            if (yield* resumeQuoteStale(cycle, now)) return yield* giveUpResume(cycle, payment, now);
          } else if (now >= cycle.startsAt) {
            return yield* giveUpAtStart(ctx, cycle, payment, now);
          }
          return yield* retryUnanswered(billing, ctx, cycle, payment, now);
        }
        // Answered but not settled (a crash, or a webhook still on its way),
        // or failed without the cycle moving on.
        yield* settleQuietly(payment, now);
        return;
      }
      case 'authorised':
        if (now < cycle.captureAt) return;
        return yield* capture(billing, ctx, cycle, now);
      case 'capturing': {
        const found = yield* findPayment(cycle.paymentId);
        if (found === null) return;
        // A crash right after the claim may have skipped the reduced
        // breakdown (M6): written again before anything else.
        const payment = yield* syncCaptureBreakdown(cycle, found);
        // A capture that crashed or failed: what does the provider say now?
        yield* settleQuietly(payment, now);
        const current = (yield* (yield* ContractBillingRepo).listCycles(cycle.contractId)).find(
          (row) => row.id === cycle.id
        );
        if (current?.status !== 'capturing') return;
        return yield* captureClaimed(ctx, current, payment, now);
      }
      case 'capture_failed': {
        if (!recoveryPending(cycle)) return;
        // The recovery never started (a surviving hold could not be
        // cancelled first): start it now.
        if (cycle.chargeMode !== 'resume') return yield* recover(ctx, cycle, now);
    const payment = yield* findPayment(cycle.paymentId);
        if (payment === null) return;
        if (payment.status === 'pending' && payment.providerReference === null) {
          // Unanswered: the same request again (never a second charge), or
          // resolved and replaced — exactly as for a first attempt.
          return yield* retryUnanswered(billing, ctx, cycle, payment, now);
        }
        if (payment.status === 'pending' || payment.status === 'authorised') {
          yield* settleQuietly(payment, now);
          return;
        }
        if (payment.status !== 'failed') return;
        const due = cycle.nextRetryAt ?? new Date(cycle.updatedAt.getTime() + retryHours * HOUR_MS);
        if (now < due) return;
        return yield* recover(ctx, cycle, now);
      }
      default:
        return;
    }
  });

/** A Poppynz/Stripe failure after the cycle was represented as funded
 * (umbrella §6): admin alerted at once, the incident documented, care goes
 * ahead and the helper's share stays owed; recovery from the family is
 * attempted. */
const systemFailure = (
  ctx: BillingContext,
  cycle: ContractCycle,
  detail: string,
  now: Date
): Step<void> =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const recorded = yield* repo.recordIncident({
      contractId: cycle.contractId,
      cycleId: cycle.id,
      kind: 'capture_failed',
      detail
    });
    if (!recorded) return;
    yield* alertAdmins(`Funded cycle lost its payment on contract ${cycle.contractId}`, [
      `Cycle ${cycle.index + 1} (${cycleDates(cycle)}) was represented as funded but could not be captured: ${detail}.`,
      `Poppynz funds the helper's completed sessions (share ${((cycle.providerShareCents ?? 0) / 100).toFixed(2)} CAD) while recovery from the family is attempted.`,
      'Later cycles keep the normal charge gate: nothing new starts unfunded.'
    ]);
    yield* recover(ctx, cycle, now);
  });

/** One recovery charge on the family's card for a cycle that lost its
 * payment. Whatever is left of the original hold is cancelled first, so the
 * family is never held twice for the same care — and if the provider says
 * it was captured after all, that is recorded instead. */
const recover = (ctx: BillingContext, cycle: ContractCycle, now: Date): Step<void> =>
  Effect.gen(function* () {
    if (cycle.familyTotalCents === null) return;
    if (cycle.chargeMode !== 'resume') {
      const original = yield* findPayment(cycle.paymentId);
      if (original !== null && original.providerReference !== null) {
        const payments = yield* Payments;
        const paymentRepo = yield* PaymentRepo;
        const after = yield* payments.cancelPayment(original.providerReference).pipe(Effect.either);
        if (Either.isLeft(after)) {
          yield* Effect.logWarning(
            `[billing] could not cancel the lost hold of cycle ${cycle.id}; recovery waits`,
            after.left
          );
          return;
        }
        if (after.right.status === 'succeeded') {
          const captured = yield* paymentRepo.advance(original.id, {
            from: ['pending', 'authorised', 'failed'],
            set: {
              status: 'captured',
              capturedAt: now,
              capturedCents:
                after.right.receivedCents > 0 ? after.right.receivedCents : original.totalCents,
              receiptUrl: after.right.receiptUrl,
              lastError: null
            }
          });
          if (captured) yield* onCaptured(cycle, captured, now);
          return;
        }
      }
    }
    const amounts: ContractAmounts = {
      serviceCents: cycle.serviceCents ?? 0,
      serviceTaxLines: cycle.taxLines.filter(
        (line) => line.supplyType === 'care_service_value'
      ) as Array<TaxLine>,
      familyFeeBps: cycle.familyFeeBps ?? 0,
      familyFeeCents: cycle.familyFeeCents ?? 0,
      familyFeeTaxLines: cycle.taxLines.filter(
        (line) => line.supplyType === 'family_service_fee'
      ) as Array<TaxLine>,
      familyTotalCents: cycle.familyTotalCents,
      providerCommissionBps: cycle.providerCommissionBps ?? 0,
      providerCommissionCents: cycle.providerCommissionCents ?? 0,
      providerCommissionTaxLines: cycle.taxLines.filter(
        (line) => line.supplyType === 'provider_commission'
      ) as Array<TaxLine>,
      providerShareCents: cycle.providerShareCents ?? 0
    };
    yield* attempt(ctx, cycle, 'resume', amounts, ['capture_failed'], now);
  });

// ---------------------------------------------------------------------------
// Readiness gate (spec §5)

const READINESS_THRESHOLDS = [7, 3, 1] as const;

const sendDueReminder = (billing: ContractBilling, ctx: BillingContext, today: string) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const days = daysBetween(today, billing.startsOn);
    const due = READINESS_THRESHOLDS.filter(
      (threshold) => days <= threshold && !billing.remindersSent.includes(String(threshold))
    );
    if (due.length === 0) return;
    const updated = yield* repo.advanceBilling(billing.contractId, {
      from: ['awaiting_payment_readiness'],
      set: { remindersSent: [...billing.remindersSent, ...due.map(String)] }
    });
    if (!updated) return;
    const nearest = Math.min(...due);
    // The family is copied from the 3-day reminder.
    yield* sendBillingNotice(
      'readiness_reminder',
      nearest <= 3 ? ['helper', 'family'] : ['helper'],
      {
        contract: ctx.contract,
        startsOn: billing.startsOn,
        daysToStart: days
      }
    );
  });

const cancelForReadiness = (billing: ContractBilling, ctx: BillingContext, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const contracts = yield* ContractRepo;
    const cancelled = yield* repo.advanceBilling(billing.contractId, {
      from: ['awaiting_payment_readiness'],
      set: { status: 'cancelled', cancelledAt: now }
    });
    if (!cancelled) return;
    yield* contracts.endForBilling(
      billing.contractId,
      "Cancelled — the helper's payout account wasn't ready in time. Nothing was charged."
    );
    for (const cycle of yield* repo.listCycles(billing.contractId)) {
      if (cycle.status === 'scheduled') {
        yield* repo.advanceCycle(cycle.id, { from: ['scheduled'], set: { status: 'cancelled' } });
      }
    }
    yield* repo.setSessionStatus(
      { contractId: billing.contractId, from: ['scheduled', 'suspended'] },
      'cancelled'
    );
    yield* sendBillingNotice('cancelled_not_ready', ['helper', 'family'], {
      contract: ctx.contract
    });
  });

// ---------------------------------------------------------------------------
// Resume (spec §4)

/** What resuming a suspended contract would charge now: the current
 * suspended cycle's sessions that have not started (plus what was carried
 * into it). Null when nothing is left to charge in it. */
const resumePlan = (billing: ContractBilling, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const current = (yield* repo.listCycles(billing.contractId))
      .filter((cycle) => cycle.status === 'suspended' && cycle.endsAt > now)
      .at(-1);
    if (!current) return null;
    const remaining = (yield* repo.listSessions(billing.contractId, current.id)).filter(
      (session) => session.status === 'suspended' && session.startsAt > now
    );
    if (remaining.length === 0) return null;
    const quote = yield* quoteFor(billing, current, valueOf(remaining) + current.carriedInCents);
    return { current, remaining, quote };
  });

const resume = (
  billing: ContractBilling,
  ctx: BillingContext,
  now: Date,
  trigger: 'card_replaced' | 'tick'
) =>
  Effect.gen(function* () {
    if (billing.status !== 'suspended') return;
    const reason = billing.suspendedReason;
    // A card problem waits for the family to fix the card.
    if (trigger === 'tick' && reason === 'card') return;
    const repo = yield* ContractBillingRepo;
    const cycles = yield* repo.listCycles(billing.contractId);
    // A resume charge is already under way (perhaps unanswered): it, not a
    // second quote, decides whether the contract resumes.
    if (cycles.some((cycle) => cycle.status === 'authorising' && cycle.chargeMode === 'resume')) {
      return;
    }
    // Never charge for care the helper can't be paid for (or might not be).
    if ((yield* paymentReadiness(ctx.contract.providerUserId)) !== 'ready') return;
    const today = todayIn(billing.timeZone, now);
    if (ctx.terms.endsOn !== null && ctx.terms.endsOn < today) {
      // The effective end has passed: nothing is charged.
      yield* repo.advanceBilling(billing.contractId, {
        from: ['suspended'],
        set: { status: 'ended', endedAt: now, suspendedReason: null }
      });
      return;
    }
    const plan = yield* resumePlan(billing, now);
    if (plan === null) {
      // Nothing left to charge in the current cycle; the next one follows
      // the normal schedule.
      yield* repo.advanceBilling(billing.contractId, {
        from: ['suspended'],
        set: { status: 'active', suspendedReason: null, suspendedAt: null }
      });
      return;
    }
    const { current, quote } = plan;
    if (!quote.ok) return;
    if (quote.amounts.familyTotalCents < MINIMUM_CHARGE_CENTS) {
      // Too small to charge: resumed at Poppynz's cost. The cycle counts as
      // paid (nothing to charge), so its sessions complete as they end.
      const absorbed = yield* repo.advanceCycle(current.id, {
        from: ['suspended'],
        set: { status: 'empty', resumeFrom: now, ...quoteColumns(quote.amounts) }
      });
      if (!absorbed) return;
      yield* repo.setSessionStatus(
        {
          contractId: billing.contractId,
          cycleId: current.id,
          from: ['suspended'],
          startsAfter: now
        },
        'scheduled'
      );
      yield* repo.appendLedger([
        {
          contractId: billing.contractId,
          cycleId: current.id,
          entryKey: `cycle:${current.id}:resume_absorbed`,
          kind: 'carry_absorbed',
          party: 'platform',
          amountCents: quote.amounts.familyTotalCents
        }
      ]);
      yield* repo.advanceBilling(billing.contractId, {
        from: ['suspended'],
        set: { status: 'active', suspendedReason: null, suspendedAt: null }
      });
      return;
    }
    yield* attempt(ctx, current, 'resume', quote.amounts, ['suspended'], now);
  });

/** What replacing the card would charge at once on each of the family's
 * card-suspended contracts (the card dialog says so before saving). */
export const previewCardResumes = (userId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const charges: Array<{ contractId: string; dates: string; amountCents: number }> = [];
    for (const billing of yield* repo.listLiveBillingForFamily(userId)) {
      if (billing.status !== 'suspended' || billing.suspendedReason !== 'card') continue;
      const plan = yield* resumePlan(billing, now);
      if (plan === null || !plan.quote.ok) continue;
      if (plan.quote.amounts.familyTotalCents < MINIMUM_CHARGE_CENTS) continue;
      charges.push({
        contractId: billing.contractId,
        dates: cycleDates(plan.current),
        amountCents: plan.quote.amounts.familyTotalCents
      });
    }
    return charges;
  });

// ---------------------------------------------------------------------------
// Settlement of a contract-cycle payment (the cycle branch of settlePayment)

export type CycleSettleOutcome =
  | 'authorised'
  | 'captured'
  | 'declined'
  | 'lost_hold'
  | 'pending'
  | 'final'
  | 'mismatch'
  | 'skipped'
  /** A provider payment on a given-up attempt, cancelled or refunded. */
  | 'released';

const writeLedger = (cycle: ContractCycle, payment: Payment) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const sessions = billedSessions(yield* repo.listSessions(cycle.contractId, cycle.id));
    const base = { contractId: cycle.contractId, cycleId: cycle.id };
    const key = (suffix: string) => `cycle:${cycle.id}:${suffix}`;
    const taxEntries = (
      supplyType: string,
      kind: BillingLedgerInsert['kind']
    ): Array<BillingLedgerInsert> =>
      cycle.taxLines
        .filter((line) => line.supplyType === supplyType && line.taxCents > 0)
        .map((line) => ({
          ...base,
          entryKey: key(`${kind}:${line.jurisdiction}:${line.component}`),
          kind,
          party: 'platform' as const,
          amountCents: line.taxCents,
          label: line.label
        }));
    yield* repo.appendLedger([
      ...sessions.map((session) => ({
        ...base,
        sessionId: session.id,
        entryKey: key(`session:${session.id}`),
        kind: 'session' as const,
        party: 'family' as const,
        amountCents: session.valueCents,
        label: `${session.serviceName} ${session.date}`
      })),
      ...taxEntries('care_service_value', 'service_tax'),
      {
        ...base,
        entryKey: key('family_fee'),
        kind: 'family_fee',
        party: 'platform',
        amountCents: cycle.familyFeeCents ?? 0
      },
      ...taxEntries('family_service_fee', 'family_fee_tax'),
      {
        ...base,
        entryKey: key('provider_commission'),
        kind: 'provider_commission',
        party: 'platform',
        amountCents: cycle.providerCommissionCents ?? 0
      },
      ...taxEntries('provider_commission', 'provider_commission_tax'),
      {
        ...base,
        paymentId: payment.id,
        entryKey: key(`capture:${payment.id}`),
        kind: 'capture',
        party: 'family',
        amountCents: payment.capturedCents ?? payment.totalCents
      }
    ]);
  });

const onCaptured = (cycle: ContractCycle, payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const moved = yield* repo.advanceCycle(cycle.id, {
      from: ['authorising', 'authorised', 'capturing', 'capture_failed'],
      paymentId: payment.id,
      set: {
        status: 'captured',
        capturedCents: payment.capturedCents ?? payment.totalCents,
        capturedAt: now,
        fundedAt: cycle.fundedAt ?? now,
        lastError: null
      }
    });
    const current =
      moved ??
      (yield* repo.listCycles(cycle.contractId)).find((row) => row.id === cycle.id) ??
      null;
    if (current === null || current.status !== 'captured' || current.paymentId !== payment.id) {
      return;
    }
    if (current.chargeMode === 'resume' && cycle.status !== 'capture_failed') {
      // The prorated rest of a suspended cycle: its sessions go ahead again.
      yield* repo.setSessionStatus(
        {
          contractId: current.contractId,
          cycleId: current.id,
          from: ['suspended'],
          startsAfter: current.resumeFrom ?? payment.createdAt
        },
        'scheduled'
      );
      const resumed = yield* repo.advanceBilling(current.contractId, {
        from: ['suspended'],
        set: { status: 'active', suspendedReason: null, suspendedAt: null }
      });
      if (resumed) {
        const contract = yield* (yield* ContractRepo).findById(current.contractId);
        if (contract) {
          yield* sendBillingNotice('resumed', ['family', 'helper'], {
            contract,
            cycle: current,
            amountCents: current.capturedCents,
            // The helper is told what they receive, not what the family paid.
            helperAmountCents: current.providerShareCents
          });
        }
      }
    }
    // The first funded cycle makes the billing active.
    yield* repo.advanceBilling(current.contractId, {
      from: ['scheduled'],
      set: { status: 'active' }
    });
    yield* writeLedger(current, payment);
  });

const declined = (cycle: ContractCycle | null, payment: Payment, reason: string, now: Date) =>
  Effect.gen(function* () {
    if (cycle === null || cycle.paymentId !== payment.id) return 'declined' as const;
    const repo = yield* ContractBillingRepo;
    if (cycle.status === 'capture_failed' && cycle.chargeMode === 'resume') {
      // A recovery charge after a system failure was declined: tried again
      // on schedule and when the card is replaced, up to a limit.
      const { retryHours } = yield* contractBillingPolicy;
      const marked = yield* markNotice(cycle, `recovery_declined:${cycle.attempts}`);
      if (marked) {
        yield* repo.advanceCycle(cycle.id, {
          from: ['capture_failed'],
          paymentId: payment.id,
          set: { nextRetryAt: new Date(now.getTime() + retryHours * HOUR_MS), lastError: reason }
        });
        yield* alertAdmins(`Recovery charge declined on contract ${cycle.contractId}`, [
          `Cycle ${cycle.index + 1} (${cycleDates(cycle)}): ${reason}`,
          recoveryDeclines(marked) < MAX_RECOVERY_DECLINES
            ? `Retried in ${retryHours} h and whenever the family replaces the card.`
            : 'No more automatic retries: settle it with the family.'
        ]);
      }
      return 'declined' as const;
    }
    if (cycle.status !== 'authorising') return 'declined' as const;
    const billing = yield* repo.findBilling(cycle.contractId);
    const ctx = billing === null ? null : yield* loadContext(billing);
    if (billing === null || ctx === null) return 'declined' as const;
    const contract = ctx.contract;
    const { retryHours } = yield* contractBillingPolicy;
    if (cycle.chargeMode === 'resume') {
      const back = yield* repo.advanceCycle(cycle.id, {
        from: ['authorising'],
        paymentId: payment.id,
        set: { status: 'suspended', lastError: reason }
      });
      if (back) {
        // The resume charge itself failed: now it is the card.
        yield* repo.advanceBilling(cycle.contractId, {
          from: ['suspended'],
          set: { suspendedReason: 'card' }
        });
        yield* sendBillingNotice('charge_failed', ['family'], {
          contract,
          cycle: back,
          amountCents: payment.totalCents
        });
      }
      return 'declined' as const;
    }
    const late =
      cycle.chargeMode === 'immediate' &&
      cycle.attempts === 1 &&
      billing.billableFrom !== null &&
      billing.billableFrom > cycle.holdAt;
    if (late || now >= cycle.startsAt) {
      // Late booking (no grace period) or past the cycle start: the first
      // session is not activated.
      yield* suspendCycle(ctx, cycle, 'card', ['authorising'], now, reason);
      return 'declined' as const;
    }
    const graced = yield* repo.advanceCycle(cycle.id, {
      from: ['authorising'],
      paymentId: payment.id,
      set: {
        status: 'grace',
        nextRetryAt: new Date(now.getTime() + retryHours * HOUR_MS),
        lastError: reason
      }
    });
    if (graced && !graced.noticesSent.includes('hold_declined')) {
      const marked = yield* markNotice(graced, 'hold_declined');
      if (marked) {
        yield* sendBillingNotice('hold_declined', ['family'], {
          contract,
          cycle: graced,
          amountCents: payment.totalCents
        });
        yield* sendBillingNotice('payment_pending', ['helper'], { contract, cycle: graced });
      }
    }
    return 'declined' as const;
  });

/** Puts a cycle whose attempt failed for a reason that is not the card's
 * back where it can be retried: suspended (provider_unavailable) once the
 * cycle has started or for a resume, otherwise a quiet grace period. */
const providerSideFailure = (cycle: ContractCycle, payment: Payment, reason: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    if (cycle.chargeMode === 'resume') {
      const back = yield* repo.advanceCycle(cycle.id, {
        from: ['authorising'],
        paymentId: payment.id,
        set: { status: 'suspended', lastError: reason }
      });
      if (back) {
        yield* repo.advanceBilling(cycle.contractId, {
          from: ['suspended'],
          set: { suspendedReason: 'provider_unavailable' }
        });
      }
      return;
    }
    if (now >= cycle.startsAt) {
      const billing = yield* repo.findBilling(cycle.contractId);
      const ctx = billing ? yield* loadContext(billing) : null;
      if (ctx) {
        yield* suspendCycle(ctx, cycle, 'provider_unavailable', ['authorising'], now, reason);
      }
      return;
    }
    const { retryHours } = yield* contractBillingPolicy;
    yield* repo.advanceCycle(cycle.id, {
      from: ['authorising'],
      paymentId: payment.id,
      set: {
        status: 'grace',
        nextRetryAt: new Date(now.getTime() + retryHours * HOUR_MS),
        lastError: reason
      }
    });
  });

/** A failed attempt whose cycle never moved on (M2). */
const failedAttempt = (cycle: ContractCycle, row: Payment, now: Date) =>
  row.lastError === UNANSWERED ||
  row.status === 'refunded' ||
  row.lastError === 'superseded by a concurrent attempt'
    ? providerSideFailure(cycle, row, row.lastError ?? UNANSWERED, now)
    : declined(cycle, row, row.lastError ?? 'The card was declined.', now).pipe(Effect.asVoid);

/** The provider's answer doesn't match the row: flagged for an admin, any
 * hold it holds released, the attempt failed and the cycle retried — never
 * blamed on the card. A charge already taken is left for the admin. */
const mismatchedAttempt = (
  cycle: ContractCycle,
  row: Payment,
  fetched: ProviderPayment,
  reason: string,
  now: Date
) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    if (fetched.status !== 'succeeded') {
      yield* payments
        .cancelPayment(fetched.reference)
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`[billing] could not release mismatched ${fetched.reference}`, error)
          )
        );
    }
    yield* alertAdmins(`Provider payment does not match payment ${row.id}`, [
      `Contract ${cycle.contractId}, cycle ${cycle.index + 1} (${cycleDates(cycle)}): ${reason}.`,
      fetched.status === 'succeeded'
        ? 'The provider shows it as charged: check it and refund by hand.'
        : 'Its hold was released; billing retries with a new attempt.'
    ]);
    const failed =
      (yield* paymentRepo.advance(row.id, {
        from: ['pending', 'authorised'],
        set: { status: 'failed', lastError: reason }
      })) ?? row;
    yield* providerSideFailure(cycle, failed, reason, now);
    return failed;
  });

/** The cycle branch of the one settle path. Re-fetches unless the caller just
 * got the provider's answer, checks it against the row, and applies it with
 * compare-and-set writes. Safe to repeat from any caller. */
export const settleCycleRow = (
  row: Payment,
  now: Date,
  answered?: ProviderPayment
): Step<{ outcome: CycleSettleOutcome; payment: Payment }> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const repo = yield* ContractBillingRepo;
    const cycle = yield* repo.findCycleByPaymentId(row.id);

    if (row.status === 'captured') {
      // A crash between the payment write and the cycle's: finish it.
      if (cycle !== null && cycle.status !== 'captured') yield* onCaptured(cycle, row, now);
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    if (row.status === 'failed' || row.status === 'refunded') {
      // A crash between failing the attempt and moving its cycle: finish it.
      if (cycle !== null && cycle.paymentId === row.id && cycle.status === 'authorising') {
        yield* failedAttempt(cycle, row, now);
      }
      return { outcome: 'final' as CycleSettleOutcome, payment: row };
    }
    if (row.provider !== payments.provider) {
      return { outcome: 'skipped' as CycleSettleOutcome, payment: row };
    }
    if (row.providerReference === null) {
      return { outcome: 'pending' as CycleSettleOutcome, payment: row };
    }
    // The charge call's own answer is as fresh as a re-fetch; any other
    // caller (webhook, recovery job, tick) re-fetches.
    const fetched =
      answered && answered.reference === row.providerReference
        ? answered
        : yield* payments.getPayment(row.providerReference);
    if (
      fetched.metadata.payment_id !== row.id ||
      fetched.amountCents !== row.totalCents ||
      fetched.currency.toLowerCase() !== row.currency.toLowerCase()
    ) {
      const reason = `provider payment ${fetched.reference} does not match this row`;
      const flagged = yield* paymentRepo.update(row.id, { lastError: reason });
      if (cycle !== null && cycle.paymentId === row.id && cycle.status === 'authorising') {
        return {
          outcome: 'mismatch' as CycleSettleOutcome,
          payment: yield* mismatchedAttempt(cycle, flagged, fetched, reason, now)
        };
      }
      return { outcome: 'mismatch' as CycleSettleOutcome, payment: flagged };
    }

    switch (fetched.status) {
      case 'authorised': {
        const held =
          (yield* paymentRepo.advance(row.id, {
            from: 'pending',
            set: { status: 'authorised', authorisedAt: now, lastError: null }
          })) ?? (yield* paymentRepo.findById(row.id));
        if (cycle !== null) {
          yield* repo.advanceCycle(cycle.id, {
            from: ['authorising'],
            paymentId: row.id,
            set: {
              status: 'authorised',
              heldCents: fetched.capturableCents > 0 ? fetched.capturableCents : row.totalCents,
              fundedAt: now
            }
          });
        }
        return { outcome: 'authorised' as CycleSettleOutcome, payment: held };
      }
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
        if (cycle !== null && captured.status === 'captured')
          yield* onCaptured(cycle, captured, now);
        return { outcome: 'captured' as CycleSettleOutcome, payment: captured };
      }
      case 'failed':
      case 'requires_action':
      case 'canceled': {
        if (row.status === 'authorised' && fetched.status === 'canceled') {
          // A hold we didn't release has gone (expired, or cancelled at the
          // provider): the cycle was represented as funded.
          const lost =
            (yield* paymentRepo.advance(row.id, {
              from: 'authorised',
              set: { status: 'failed', lastError: 'hold expired or cancelled before capture' }
            })) ?? row;
          if (cycle !== null) {
            const failed = yield* repo.advanceCycle(cycle.id, {
              from: ['authorised', 'capturing'],
              paymentId: row.id,
              set: {
                status: 'capture_failed',
                lastError: 'hold expired or cancelled before capture'
              }
            });
            if (failed) {
              const billing = yield* repo.findBilling(failed.contractId);
              const ctx = billing ? yield* loadContext(billing) : null;
              if (ctx) yield* systemFailure(ctx, failed, 'the hold expired or was cancelled', now);
            }
          }
          return { outcome: 'lost_hold' as CycleSettleOutcome, payment: lost };
        }
        // A declined attempt can still be confirmed with another card at the
        // provider: cancel it first so it is terminal, and if it succeeded in
        // the meantime, record that instead.
        const after =
          fetched.status === 'canceled'
            ? fetched
            : yield* payments.cancelPayment(row.providerReference);
        if (after.status === 'succeeded') {
          return yield* settleCycleRow(row, now, after);
        }
        const reason = fetched.failureReason ?? 'The card was declined.';
        const failedRow =
          (yield* paymentRepo.advance(row.id, {
            from: 'pending',
            set: { status: 'failed', lastError: reason }
          })) ?? row;
        yield* declined(cycle, failedRow, reason, now);
        return { outcome: 'declined' as CycleSettleOutcome, payment: failedRow };
      }
      default:
        return { outcome: 'pending' as CycleSettleOutcome, payment: row };
    }
  });

// ---------------------------------------------------------------------------
// Entry points

/** The billing row an acceptance inserts (in the acceptance transaction). */
export const newContractBilling = (input: {
  timeZone: string;
  startsOn: string;
  familyProvince: ProvinceCode;
  helperProvince: ProvinceCode;
  helperReady: boolean;
  now: Date;
}) =>
  contractBillingPolicy.pipe(
    Effect.map(
      (policy): Omit<ContractBillingInsert, 'contractId' | 'acceptedVersionId'> => ({
        status: input.helperReady ? 'scheduled' : 'awaiting_payment_readiness',
        familyFeeBps: policy.familyCommissionBps,
        providerCommissionBps: policy.providerCommissionBps,
        familyProvince: input.familyProvince,
        helperProvince: input.helperProvince,
        timeZone: input.timeZone,
        startsOn: input.startsOn,
        billableFrom: input.helperReady ? input.now : null,
        remindersSent: []
      })
    )
  );

/** An attempt left unanswered on a cycle that has moved on (suspended or
 * cancelled while the provider could not be asked): looked up again, and
 * whatever exists for it released, so no hold or charge is orphaned. */
const resolveStrandedAttempts = (contractId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    for (const cycle of yield* repo.listCycles(contractId)) {
      if (cycle.status !== 'suspended' && cycle.status !== 'cancelled') continue;
      const payment = yield* findPayment(cycle.paymentId);
      if (isUnanswered(payment, now)) yield* releaseUnanswered(cycle, payment, now);
    }
  });

/** One contract's billing step. */
export const runContractBilling = (contractId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    let billing = yield* repo.findBilling(contractId);
    if (billing === null || !liveBillingStatuses.includes(billing.status)) return 'idle' as const;
    const ctx = yield* loadContext(billing);
    if (ctx === null) return 'idle' as const;
    const today = todayIn(billing.timeZone, now);

    if (billing.status === 'awaiting_payment_readiness') {
      const readiness = yield* paymentReadiness(ctx.contract.providerUserId);
      if (readiness === 'ready') {
        billing =
          (yield* repo.advanceBilling(contractId, {
            from: ['awaiting_payment_readiness'],
            set: { status: 'scheduled', billableFrom: now }
          })) ?? billing;
      } else {
        yield* materialise(billing, ctx.terms, today);
        yield* sendDueReminder(billing, ctx, today);
        // Only a confirmed "not ready" cancels; an unknown status waits.
        const first = (yield* repo.listCycles(contractId))[0];
        if (readiness === 'not_ready' && first && now >= first.captureAt) {
          yield* cancelForReadiness(billing, ctx, now);
        }
        return 'awaiting' as const;
      }
    }

    yield* materialise(billing, ctx.terms, today);
    yield* applyEnd(billing, ctx.terms);
    yield* resolveStrandedAttempts(contractId, now);
    const afterEnd = (yield* repo.findBilling(contractId)) ?? billing;
    yield* resume(afterEnd, ctx, now, 'tick');

    const indexes = (yield* repo.listCycles(contractId)).map((cycle) => cycle.index);
    for (const index of indexes) {
      // Fresh rows each time: an earlier cycle may have suspended the
      // contract or carried an amount into this one.
      const current = yield* repo.findBilling(contractId);
      const cycle = (yield* repo.listCycles(contractId)).find((row) => row.index === index);
      if (
        current === null ||
        cycle === undefined ||
        !liveBillingStatuses.includes(current.status)
      ) {
        continue;
      }
      if (!openCycleStatuses.includes(cycle.status) && !recoveryPending(cycle)) continue;
      yield* processCycle(current, ctx, cycle, now);
    }

    // Funded sessions complete as they end.
    for (const cycle of yield* repo.listCycles(contractId)) {
      if (fundedCycleStatuses.includes(cycle.status)) {
        yield* repo.setSessionStatus(
          { contractId, cycleId: cycle.id, from: ['scheduled'], endedBy: now },
          'completed'
        );
      }
      // A carried-in amount whose cycle was never charged (cancelled, or
      // suspended to its end) is absorbed by Poppynz, never lost.
      if (
        cycle.carriedInCents > 0 &&
        (cycle.status === 'cancelled' || (cycle.status === 'suspended' && cycle.endsAt <= now))
      ) {
        yield* repo.appendLedger([
          {
            contractId,
            cycleId: cycle.id,
            entryKey: `cycle:${cycle.id}:carry_absorbed`,
            kind: 'carry_absorbed',
            party: 'platform',
            amountCents: cycle.carriedInCents
          }
        ]);
      }
    }

    // Past the last day with nothing in motion: the schedule is done.
    if (ctx.terms.endsOn !== null && ctx.terms.endsOn < today) {
      const cycles = yield* repo.listCycles(contractId);
      if (
        !cycles.some((cycle) => openCycleStatuses.includes(cycle.status) || recoveryPending(cycle))
      ) {
        yield* repo.advanceBilling(contractId, {
          from: liveBillingStatuses,
          set: { status: 'ended', endedAt: now, suspendedReason: null }
        });
      }
    }
    return 'ran' as const;
  });

/** Right after acceptance: the readiness reminder (when the helper isn't
 * ready yet) and the first billing step, so a late booking is charged as
 * soon as it is binding. */
export const startContractBilling = (contractId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const billing = yield* repo.findBilling(contractId);
    if (billing === null) return 'idle' as const;
    if (
      billing.status === 'awaiting_payment_readiness' &&
      !billing.remindersSent.includes('acceptance')
    ) {
      const ctx = yield* loadContext(billing);
      const today = todayIn(billing.timeZone, now);
      const days = daysBetween(today, billing.startsOn);
      const marked = yield* repo.advanceBilling(contractId, {
        from: ['awaiting_payment_readiness'],
        set: {
          remindersSent: [
            'acceptance',
            // Thresholds already reached are not sent again on the next tick.
            ...READINESS_THRESHOLDS.filter((threshold) => days <= threshold).map(String)
          ]
        }
      });
      if (marked && ctx) {
        yield* sendBillingNotice('readiness_reminder', ['helper'], {
          contract: ctx.contract,
          startsOn: billing.startsOn,
          daysToStart: days
        });
      }
    }
    return yield* runContractBilling(contractId, now);
  });

/** The family replaced their card: retry every declined hold and resume
 * every suspended contract at once (spec §4). `contractId` narrows it to one
 * contract (the "Retry payment" button). */
export const retryFamilyBilling = (
  userId: string,
  now: Date,
  options: { contractId?: string } = {}
) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    let retried = 0;
    const live = (yield* repo.listLiveBillingForFamily(userId)).filter(
      (billing) => options.contractId === undefined || billing.contractId === options.contractId
    );
    for (const billing of live) {
      const ctx = yield* loadContext(billing);
      if (ctx === null) continue;
      for (const cycle of yield* repo.listCycles(billing.contractId)) {
        if (cycle.status === 'grace' && now < cycle.startsAt) {
          retried += 1;
          yield* fund(billing, ctx, cycle, ['grace'], now);
        }
        const unanswered =
          (cycle.status === 'authorising' && cycle.chargeMode !== 'resume' && now < cycle.startsAt) ||
          (recoveryPending(cycle) && cycle.chargeMode === 'resume');
        if (recoveryPending(cycle) && cycle.chargeMode === 'resume') {
          // A declined recovery after a system failure: the new card, now.
          const payment = yield* findPayment(cycle.paymentId);
          if (payment?.status === 'failed') {
            retried += 1;
            yield* recover(ctx, cycle, now);
          }
        }
        if (unanswered) {
          // An attempt the provider never answered, still on the old card:
          // resolved now rather than on the next tick (R4).
          const payment = yield* findPayment(cycle.paymentId);
          if (payment?.status === 'pending' && payment.providerReference === null) {
            retried += 1;
            yield* retryUnanswered(billing, ctx, cycle, payment, now);
          }
        }
      }
      const current = yield* repo.findBilling(billing.contractId);
      if (current?.status === 'suspended') {
        retried += 1;
        yield* resume(current, ctx, now, 'card_replaced');
      }
    }
    return retried;
  });

/** UAT round 2 #13: whether the family has something to retry on this
 * contract — a declined hold still in its grace period, or a contract
 * suspended because the card failed. (A Poppynz/Stripe outage or a helper
 * who isn't payment-ready is not the family's to retry.) */
export const familyRetryEligible = (
  billing: Pick<ContractBilling, 'status' | 'suspendedReason'> | null,
  cycles: ReadonlyArray<Pick<ContractCycle, 'status' | 'startsAt'>>,
  now: Date
) =>
  billing !== null &&
  liveBillingStatuses.includes(billing.status) &&
  ((billing.status === 'suspended' && billing.suspendedReason === 'card') ||
    cycles.some((cycle) => cycle.status === 'grace' && now < cycle.startsAt));

export type FamilyRetryOutcome = 'charged' | 'declined' | 'in_progress';

/** The family's "Retry payment" on one contract: the card-replaced retry
 * path (every idempotency key and lookup guard included), then what came of
 * it — an attempt still waiting on the provider, still declined, or funded. */
export const retryContractPayment = (userId: string, contractId: string, now: Date) =>
  Effect.gen(function* () {
    yield* retryFamilyBilling(userId, now, { contractId });
    const repo = yield* ContractBillingRepo;
    const billing = yield* repo.findBilling(contractId);
    const cycles = yield* repo.listCycles(contractId);
    if (cycles.some((cycle) => cycle.status === 'authorising' || cycle.status === 'capturing')) {
      return 'in_progress' as FamilyRetryOutcome;
    }
    return (
      familyRetryEligible(billing, cycles, now) ? 'declined' : 'charged'
    ) as FamilyRetryOutcome;
  });

export type ContractBillingTickSummary = {
  contracts: number;
  ran: number;
  failed: number;
};

/** The worker's 15-minute tick (and the dev clock): every live contract,
 * each isolated — one contract's failure never stops the others. */
export const runContractBillingTick = (now: Date, options: { contractId?: string } = {}) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const live = (yield* repo.listLiveBilling()).filter(
      (billing) => !options.contractId || billing.contractId === options.contractId
    );
    const summary: ContractBillingTickSummary = { contracts: live.length, ran: 0, failed: 0 };
    for (const billing of live) {
      const exit = yield* runContractBilling(billing.contractId, now).pipe(Effect.exit);
      if (exit._tag === 'Failure') {
        summary.failed += 1;
        yield* Effect.logError(`[billing] contract ${billing.contractId} failed`, exit.cause);
      } else {
        summary.ran += 1;
      }
    }
    return summary;
  });

/** Provides the cycle branch of `settlePayment` from contract billing's own
 * dependencies, so every caller of the one settle path (browser confirm,
 * webhook, recovery job, tick) lands contract payments the same way. */
export const CycleSettlementLive = Layer.effect(
  CycleSettlement,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      | ContractBillingRepo
      | ContractRepo
      | PaymentRepo
      | Payments
      | BillingCustomerRepo
      | PayoutAccountRepo
      | TaxConfigRepo
      | UserRepo
      | UserProfileRepo
      | Mailer
      | NotificationHub
    >();
    return {
      settle: (row: Payment, now: Date) => settleCycleRow(row, now).pipe(Effect.provide(context)),
      adopt: (row: Payment, fetched: ProviderPayment, now: Date) =>
        adoptProviderPayment(row, fetched, now).pipe(Effect.provide(context))
    };
  })
);

/** TEST HELPER: every contract-billing dependency as an empty, inert stand-in
 * (no contracts, no users, mail and notifications dropped), for suites whose
 * code path can reach contract billing without being about it. Merge it
 * FIRST so the suite's own layers override what they care about. */
export const makeIdleContractBillingLayer = () =>
  Layer.mergeAll(
    makeInMemoryContractBillingRepo().layer,
    EmptyContractRepoTest,
    makeInMemoryPaymentRepo().layer,
    makeInMemoryBillingCustomerRepo().layer,
    makeSeededTaxConfigRepo().layer,
    makeInMemoryPayoutAccountRepo().layer,
    makeInMemorySessionResolutionRepo().layer,
    makeUserRepoTest({
      findById: (id) => Effect.fail(new DBNotFoundErrorClass({ entity: 'user', value: id })),
      findByEmail: (email) =>
        Effect.fail(new DBNotFoundErrorClass({ entity: 'user', value: email }))
    }),
    EmptyUserProfileRepoTest,
    makeMailerTest({}),
    NoopNotificationHubTest
  );
