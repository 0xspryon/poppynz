import { daysBetween, todayIn } from '@repo/calendar';
import {
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
import { Mailer } from '@repo/mail';
import { NotificationHub } from '@repo/notify';
import { contractBillingConfig } from '@repo/env';
import type { SqlError } from '@effect/sql/SqlError';
import { Payments, type PaymentProviderError, type ProviderPayment } from '@repo/payments';
import { Effect, Either, Layer } from 'effect';
import { CycleSettlement } from '../settle';
import { toCard } from '../cards';
import { isPaymentReady } from '../payouts';
import {
  MINIMUM_CHARGE_CENTS,
  quoteContractAmounts,
  type ContractAmounts,
  type ProvinceCode,
  type TaxLine
} from '../pricing';
import { loadTaxSnapshot } from '../tax';
import { alertAdmins, cycleDates, personName, sendBillingNotice } from './notices';
import { cycleIndexOf, planCycle, planWindow, type ScheduleTerms } from './schedule';
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
const LATE_BOOKING_MS = 48 * HOUR_MS;

export const contractBillingPolicy = contractBillingConfig.pipe(
  Effect.orElseSucceed(() => ({
    familyCommissionBps: 500,
    providerCommissionBps: 1500,
    retryHours: 12
  }))
);

/** Cycles whose money is still in motion. */
const openCycleStatuses: ReadonlyArray<ContractCycleStatus> = [
  'scheduled',
  'authorising',
  'authorised',
  'grace',
  'capturing'
];

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
      endsAtMinutes: end?.endsAtMinutes ?? null
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
      set: { status: 'failed', lastError: 'hold released' }
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

const markNotice = (cycle: ContractCycle, notice: string) =>
  ContractBillingRepo.pipe(
    Effect.flatMap((repo) =>
      repo.advanceCycle(cycle.id, {
        from: [cycle.status],
        set: { noticesSent: [...cycle.noticesSent, notice] }
      })
    )
  );

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

// ---------------------------------------------------------------------------
// Charging

type ChargeMode = 'hold' | 'immediate' | 'resume';

/** "Care with Sam T. · Mon, Nov 2 – Wed, Nov 4" */
const describeCycle = (ctx: BillingContext, cycle: ContractCycle, mode: ChargeMode) =>
  Effect.gen(function* () {
    const helper = yield* personName(ctx.contract.providerUserId);
    return `${mode === 'resume' ? 'Care (resumed)' : 'Care'} with ${helper.name} · ${cycleDates(cycle)}`;
  });

/** Calls the provider for the cycle's current attempt and settles what it
 * says. A provider error leaves the attempt pending: the next tick retries
 * it under the same key, so it can never become a second charge. */
const chargeAndSettle = (
  cycle: ContractCycle,
  payment: Payment,
  now: Date
): Step<'provider_error' | 'settled' | 'declined'> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ContractBillingRepo;
    const paymentRepo = yield* PaymentRepo;
    const customers = yield* BillingCustomerRepo;
    const customer = yield* customers.findByUserId(payment.userId);
    const card = toCard(customer, payments.provider);
    if (customer === null || card === null) {
      yield* paymentRepo.advance(payment.id, {
        from: 'pending',
        set: { status: 'failed', lastError: 'There is no card on file.' }
      });
      return yield* declined(cycle, payment, 'There is no card on file.', now);
    }
    const result = yield* payments
      .chargeSavedCard({
        amountCents: payment.totalCents,
        currency: 'CAD',
        customer: customer.customerReference,
        card: card.reference,
        capture: cycle.chargeMode === 'hold' ? 'manual' : 'automatic',
        idempotencyKey: `${cycle.chargeMode === 'resume' && cycle.status === 'capture_failed' ? 'recover' : 'cycle'}-${cycle.id}-${cycle.attempts}`,
        metadata: {
          payment_id: payment.id,
          cycle_id: cycle.id,
          contract_id: cycle.contractId,
          kind: 'contract_cycle'
        },
        ...(payment.description ? { description: payment.description } : {})
      })
      .pipe(Effect.either);
    if (Either.isLeft(result)) {
      yield* repo.advanceCycle(cycle.id, {
        from: [cycle.status],
        paymentId: payment.id,
        set: { lastError: 'payment provider unavailable — retrying' }
      });
      yield* Effect.logWarning(`[billing] provider error charging cycle ${cycle.id}`, result.left);
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

/** Starts a new attempt for a cycle: a payment row first (its breakdown is
 * frozen there), then the cycle claimed for it by compare-and-set. */
const attempt = (
  ctx: BillingContext,
  cycle: ContractCycle,
  mode: ChargeMode,
  amounts: ContractAmounts,
  from: ReadonlyArray<ContractCycleStatus>,
  now: Date
): Step<'lost' | 'provider_error' | 'settled' | 'declined'> =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const paymentRepo = yield* PaymentRepo;
    const repo = yield* ContractBillingRepo;
    const description = yield* describeCycle(ctx, cycle, mode);
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
      description
    });
    const claimed = yield* repo.advanceCycle(cycle.id, {
      from,
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
    // while the helper can't be paid.
    if (!(yield* isPaymentReady(ctx.contract.providerUserId))) {
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
    const late =
      cycle.attempts === 0 &&
      billing.billableFrom !== null &&
      billing.billableFrom > cycle.holdAt &&
      first !== null &&
      first.getTime() - billing.billableFrom.getTime() < LATE_BOOKING_MS;
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

/** A held cycle is due for capture: recheck the helper, then capture what
 * its sessions are worth now (never more than the hold). */
const capture = (billing: ContractBilling, ctx: BillingContext, cycle: ContractCycle, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const payment = yield* findPayment(cycle.paymentId);
    if (payment === null || payment.providerReference === null) return;
    if (!(yield* isPaymentReady(ctx.contract.providerUserId))) {
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
    const claimed = yield* repo.advanceCycle(cycle.id, {
      from: ['authorised'],
      set: {
        status: 'capturing',
        // Sessions removed since the hold reduce what is captured; a quote
        // failure now captures the hold as quoted.
        ...(amounts !== null && amounts.familyTotalCents <= held ? quoteColumns(amounts) : {})
      }
    });
    if (!claimed) return;
    yield* captureClaimed(ctx, claimed, payment, now);
  });

const captureClaimed = (ctx: BillingContext, cycle: ContractCycle, payment: Payment, now: Date) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* ContractBillingRepo;
    const paymentRepo = yield* PaymentRepo;
    const amount = Math.min(
      cycle.familyTotalCents ?? payment.totalCents,
      cycle.heldCents ?? payment.totalCents
    );
    const result = yield* payments
      .capturePayment({
        reference: payment.providerReference!,
        amountCents: amount,
        idempotencyKey: cycle.id
      })
      .pipe(Effect.either);
    if (Either.isLeft(result)) {
      yield* Effect.logWarning(`[billing] capture failed for cycle ${cycle.id}`, result.left);
      if (now < cycle.startsAt) {
        yield* repo.advanceCycle(cycle.id, {
          from: ['capturing'],
          set: { lastError: 'capture failed at the provider — retrying' }
        });
        return;
      }
      // Represented as funded, yet the provider still refuses to capture
      // once care has started: a system failure, handled as such.
      const failed = yield* repo.advanceCycle(cycle.id, {
        from: ['capturing'],
        set: { status: 'capture_failed', lastError: 'capture kept failing at the provider' }
      });
      if (failed) yield* systemFailure(ctx, failed, 'capture kept failing at the provider', now);
      return;
    }
    yield* settleCycleRow(yield* paymentRepo.findById(payment.id), now, result.right);
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
          // key until the cycle starts; then it was never funded.
          if (now >= cycle.startsAt && cycle.chargeMode !== 'resume') {
            const paymentRepo = yield* PaymentRepo;
            yield* paymentRepo.advance(payment.id, {
              from: 'pending',
              providerReference: null,
              set: { status: 'failed', lastError: 'payment provider unavailable' }
            });
            return yield* suspendCycle(
              ctx,
              cycle,
              'provider_unavailable',
              ['authorising'],
              now,
              'payment provider unavailable'
            );
          }
          yield* chargeAndSettle(cycle, payment, now);
          return;
        }
        // Answered but not settled (a crash, or a webhook still on its way).
        yield* settleCycleRow(payment, now);
        return;
      }
      case 'authorised':
        if (now < cycle.captureAt) return;
        return yield* capture(billing, ctx, cycle, now);
      case 'capturing': {
        const payment = yield* findPayment(cycle.paymentId);
        if (payment === null) return;
        // A capture that crashed or failed: what does the provider say now?
        yield* settleCycleRow(payment, now);
        const current = (yield* (yield* ContractBillingRepo).listCycles(cycle.contractId)).find(
          (row) => row.id === cycle.id
        );
        if (current?.status !== 'capturing') return;
        return yield* captureClaimed(ctx, current, payment, now);
      }
      default:
        return;
    }
  });

/** A Poppynz/Stripe failure after the cycle was represented as funded
 * (umbrella §6): admin alerted at once, the incident documented, care goes
 * ahead and the helper's share stays owed; one recovery charge is tried. */
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
    if (cycle.familyTotalCents === null) return;
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
    if (reason === 'helper_not_ready' && !(yield* isPaymentReady(ctx.contract.providerUserId))) {
      return;
    }
    const repo = yield* ContractBillingRepo;
    const today = todayIn(billing.timeZone, now);
    if (ctx.terms.endsOn !== null && ctx.terms.endsOn < today) {
      // The effective end has passed: nothing is charged.
      yield* repo.advanceBilling(billing.contractId, {
        from: ['suspended'],
        set: { status: 'ended', endedAt: now, suspendedReason: null }
      });
      return;
    }
    const current = (yield* repo.listCycles(billing.contractId))
      .filter((cycle) => cycle.status === 'suspended' && cycle.endsAt > now)
      .at(-1);
    const remaining = current
      ? (yield* repo.listSessions(billing.contractId, current.id)).filter(
          (session) => session.status === 'suspended' && session.startsAt > now
        )
      : [];
    if (!current || remaining.length === 0) {
      // Nothing left to charge in the current cycle; the next one follows
      // the normal schedule.
      yield* repo.advanceBilling(billing.contractId, {
        from: ['suspended'],
        set: { status: 'active', suspendedReason: null, suspendedAt: null }
      });
      return;
    }
    const quote = yield* quoteFor(billing, current, valueOf(remaining));
    if (!quote.ok) return;
    if (quote.amounts.familyTotalCents < MINIMUM_CHARGE_CENTS) {
      // Too small to charge: resumed at Poppynz's cost.
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
          entryKey: `cycle:${current.id}:resume_absorbed:${now.toISOString()}`,
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
  | 'skipped';

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
            amountCents: current.capturedCents
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
    if (cycle.status !== 'authorising') return 'declined' as const;
    const repo = yield* ContractBillingRepo;
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
      const flagged = yield* paymentRepo.update(row.id, {
        lastError: `provider payment ${fetched.reference} does not match this row`
      });
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
      if (yield* isPaymentReady(ctx.contract.providerUserId)) {
        billing =
          (yield* repo.advanceBilling(contractId, {
            from: ['awaiting_payment_readiness'],
            set: { status: 'scheduled', billableFrom: now }
          })) ?? billing;
      } else {
        yield* materialise(billing, ctx.terms, today);
        yield* sendDueReminder(billing, ctx, today);
        const first = (yield* repo.listCycles(contractId))[0];
        if (first && now >= first.captureAt) yield* cancelForReadiness(billing, ctx, now);
        return 'awaiting' as const;
      }
    }

    yield* materialise(billing, ctx.terms, today);
    yield* applyEnd(billing, ctx.terms);
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
      if (!openCycleStatuses.includes(cycle.status)) continue;
      yield* processCycle(current, ctx, cycle, now);
    }

    // Funded sessions complete as they end.
    for (const cycle of yield* repo.listCycles(contractId)) {
      if (cycle.status === 'captured' || cycle.status === 'capture_failed') {
        yield* repo.setSessionStatus(
          { contractId, cycleId: cycle.id, from: ['scheduled'], endedBy: now },
          'completed'
        );
      }
    }

    // Past the last day with nothing in motion: the schedule is done.
    if (ctx.terms.endsOn !== null && ctx.terms.endsOn < today) {
      const cycles = yield* repo.listCycles(contractId);
      if (!cycles.some((cycle) => openCycleStatuses.includes(cycle.status))) {
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
 * every suspended contract at once (spec §4). */
export const retryFamilyBilling = (userId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    let retried = 0;
    for (const billing of yield* repo.listLiveBillingForFamily(userId)) {
      const ctx = yield* loadContext(billing);
      if (ctx === null) continue;
      for (const cycle of yield* repo.listCycles(billing.contractId)) {
        if (cycle.status === 'grace' && now < cycle.startsAt) {
          retried += 1;
          yield* fund(billing, ctx, cycle, ['grace'], now);
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
      settle: (row: Payment, now: Date) => settleCycleRow(row, now).pipe(Effect.provide(context))
    };
  })
);
