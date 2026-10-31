import {
  activeResolutionStatuses,
  ContractBillingRepo,
  ContractRepo,
  PaymentRepo,
  PayoutAccountRepo,
  SessionMoneyRepo,
  SessionResolutionRepo,
  fixedTransferStatuses,
  type BillingLedgerInsert,
  type Contract,
  type ContractCycle,
  type HelperTransfer,
  type HelperTransferItemInsert,
  type Payment,
  type SessionCharge,
  type SessionRecord,
  type SessionRefund,
  type SessionResolution
} from '@repo/db';
import { Payments, type ProviderRefund } from '@repo/payments';
import { Data, Effect, Either } from 'effect';
import { applyBps, type SessionChargeSplit, type SplitTaxLine } from '../pricing';
import { paymentReadiness } from '../payouts';
import {
  chargedWithCycle,
  ensureCycleSplit,
  provisionalCycleSplit,
  sessionMoneyPolicy,
  type BillingDeps
} from './engine';
import { reconciliationConfig } from '@repo/env';
import { matchPayoutExactly } from '../accounting/reconciliation';
import { cardDisputeHold, owedAfterCardDisputes } from './card-dispute-holds';
import { sendMoneyNotice } from './money-notices';
import { alertAdmins, cycleDates } from './notices';
import { sessionResolutionPolicy } from './resolutions';
import {
  effectiveSessionOutcome,
  resolveSessionMoney,
  type MoneyOutcome,
  type SessionMoney,
  type SessionMoneyPolicy
} from './session-money';

/**
 * Applying session resolutions to the money, and session-based helper
 * transfers (Tier 3 step 2, spec 2026-10-28 §7, §8).
 *
 * `reconcileSession` brings ONE session's money in line with what is in
 * effect for it (its resolution, by status and decision), by its cycle's
 * state:
 *
 *   | cycle            | mechanism                                         |
 *   | not held yet     | session left out of the plan (status `cancelled`) |
 *   | held, not taken  | capture reduced (status; a late one's compensation)|
 *   | charged          | a session refund on the cycle's charge            |
 *   | charged and paid | refund + recovery from the helper's next transfers|
 *
 * It computes the DESIRED state (the policy function on the frozen split)
 * and moves only the difference, so applying it twice — a double click, a
 * duplicate webhook, a worker retry — changes nothing, and an admin's later
 * decision moves exactly what it changes. Money already gone is never
 * reversed: an over-refund is absorbed by Poppynz (ledger), an over-paid
 * helper repays from future transfers (a recovery). The effect, refund,
 * recovery and ledger entries are written in ONE transaction; the provider
 * is called afterwards and its answer settled by `settleRefund` (from this
 * step, the tick or the webhook).
 */

export type MoneyDeps = BillingDeps | SessionResolutionRepo | SessionMoneyRepo;

/** Cycle states whose money is in flight: nothing is changed under them;
 * the next tick reconciles once they settle. */
const inFlight: ReadonlyArray<ContractCycle['status']> = ['authorising', 'capturing'];

/** A card dispute (chargeback) on the charge blocks refunds (spec §7). The
 * dispute records (Tier 3 step 4) keep this flag on the payment: set while a
 * dispute is open, cleared when it closes — or `card dispute lost`, when the
 * bank already returned the money. */
export const CARD_DISPUTE_OPEN_FLAG = 'card dispute opened';
export const CARD_DISPUTE_LOST_FLAG = 'card dispute lost';
export const cardDisputeOpen = (payment: Pick<Payment, 'lastError'> | null) =>
  payment?.lastError === CARD_DISPUTE_OPEN_FLAG;
export const cardDisputeLost = (payment: Pick<Payment, 'lastError'> | null) =>
  payment?.lastError === CARD_DISPUTE_LOST_FLAG;

/** The settings the policy function reads, and the agreement's version. */
export const moneyPolicyFor = (resolution: Pick<SessionResolution, 'policyVersion'> | null) =>
  sessionResolutionPolicy.pipe(
    Effect.map(
      (policy): SessionMoneyPolicy => ({
        version: resolution?.policyVersion ?? null,
        lateCancellationHelperBps: policy.lateCancellationHelperBps,
        cancellationNoticeHours: policy.cancellationNoticeHours
      })
    )
  );

/** A session's resolution in effect: the active one, else the latest (a
 * lapsed or reversed one is history and resolves to nothing). */
export const currentResolution = (
  rows: ReadonlyArray<SessionResolution>,
  sessionId: string
): SessionResolution | null => {
  const mine = rows.filter((row) => row.sessionId === sessionId);
  return mine.find((row) => activeResolutionStatuses.includes(row.status)) ?? mine.at(-1) ?? null;
};

const findPaymentRow = (paymentId: string | null) =>
  paymentId === null
    ? Effect.succeed(null)
    : PaymentRepo.pipe(
        Effect.flatMap((repo) => repo.findById(paymentId)),
        Effect.catchTag('DBNotFoundError', () => Effect.succeed(null))
      );

const outcomeSignature = (outcome: MoneyOutcome) =>
  outcome.kind === 'family_late' ? `family_late:${outcome.minutesWorked}` : outcome.kind;

const toSplit = (charge: SessionCharge): SessionChargeSplit => ({
  sessionId: charge.sessionId,
  basis: charge.basis,
  careCents: charge.careCents,
  careTaxLines: charge.careTaxLines,
  careTaxCents: charge.careTaxCents,
  familyFeeCents: charge.familyFeeCents,
  familyFeeTaxLines: charge.familyFeeTaxLines,
  familyFeeTaxCents: charge.familyFeeTaxCents,
  familyTotalCents: charge.familyTotalCents,
  commissionCents: charge.commissionCents,
  commissionTaxLines: charge.commissionTaxLines,
  commissionTaxCents: charge.commissionTaxCents,
  helperShareCents: charge.helperShareCents
});

const sumLines = (lines: ReadonlyArray<SplitTaxLine>) =>
  lines.reduce((total, line) => total + line.taxCents, 0);

/** `desired − already` line by line (same jurisdiction, component, rate). */
const lineDelta = (
  desired: ReadonlyArray<SplitTaxLine>,
  already: ReadonlyArray<ReadonlyArray<SplitTaxLine>>
): Array<SplitTaxLine> =>
  desired.map((line) => {
    const same = already
      .flat()
      .filter(
        (row) =>
          row.supplyType === line.supplyType &&
          row.jurisdiction === line.jurisdiction &&
          row.component === line.component &&
          row.rateMillipercent === line.rateMillipercent
      );
    return {
      ...line,
      taxCents: line.taxCents - same.reduce((t, row) => t + row.taxCents, 0),
      baseCents: line.baseCents - same.reduce((t, row) => t + row.baseCents, 0)
    };
  });

/** What has been sent to the helper for a session, net of recoveries. */
export const helperPaidSoFar = (sessionId: string) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const items = yield* repo.listTransferItems({ sessionIds: [sessionId] });
    const transfers = new Map(
      (yield* Effect.forEach([...new Set(items.map((item) => item.transferId))], (id) =>
        repo.findTransfer(id)
      ))
        .filter((row): row is HelperTransfer => row !== null)
        .map((row) => [row.id, row])
    );
    const paid = items
      .filter(
        (item) =>
          item.kind === 'session' &&
          fixedTransferStatuses.includes(transfers.get(item.transferId)?.status ?? 'due')
      )
      .reduce((t, item) => t + item.amountCents, 0);
    const recovered = (yield* repo.listRecoveries({ sessionId })).reduce(
      (t, row) => t + (row.status === 'waived' ? 0 : row.amountCents),
      0
    );
    return { paid: paid - recovered, transferred: items.length > 0 };
  });

export type ReconcileResult =
  | 'no_billing'
  | 'deferred'
  | 'excluded'
  | 'reduced_capture'
  | 'held'
  | 'refund'
  | 'refund_recovery'
  | 'none'
  | 'over_limit';

const ended = (session: SessionRecord, now: Date) => session.endsAt <= now;

/** Brings one session's money in line with its resolution (see above). */
export const reconcileSession = (
  contractId: string,
  sessionId: string,
  now: Date
): Effect.Effect<ReconcileResult, never, MoneyDeps> =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const moneyRepo = yield* SessionMoneyRepo;
    const billing = yield* billingRepo.findBilling(contractId);
    if (!billing) return 'no_billing' as const;
    const session = (yield* billingRepo.listSessions(contractId)).find((s) => s.id === sessionId);
    if (!session) return 'no_billing' as const;
    const cycle = (yield* billingRepo.listCycles(contractId)).find((c) => c.id === session.cycleId);
    if (!cycle) return 'no_billing' as const;
    // Tier 3 step 3: an extra session charged on its own payment carries its
    // own frozen split — its money is taken whatever its cycle's state.
    const ownCharge =
      (yield* billingRepo.listSessionCharges(contractId, cycle.id)).find(
        (row) => row.sessionId === sessionId && row.paymentId !== cycle.paymentId
      ) ?? null;
    if (
      ownCharge === null &&
      (inFlight.includes(cycle.status) || cycle.status === 'capture_failed')
    ) {
      return 'deferred' as const;
    }
    const resolution = currentResolution(
      yield* (yield* SessionResolutionRepo).listForContract(contractId),
      sessionId
    );
    const policy = yield* moneyPolicyFor(resolution);
    const input = { resolution, session, zone: billing.timeZone };
    const outcome = effectiveSessionOutcome(input, policy);
    const signature = `${resolution?.id ?? 'none'}:${outcomeSignature(outcome)}`;
    const effects = yield* moneyRepo.listEffects(contractId);
    const previous = effects.find((row) => row.sessionId === sessionId) ?? null;
    if (resolution === null && previous === null) return 'none' as const;

    // 1. The session's status (and, before the capture, its compensation).
    const captured = cycle.status === 'captured' || ownCharge !== null;
    const cancelled =
      outcome.kind === 'family_early' ||
      outcome.kind === 'helper_cancelled' ||
      (outcome.kind === 'family_late' && outcome.minutesWorked === 0);
    const funded = ownCharge !== null || ['captured', 'empty', 'carried'].includes(cycle.status);
    const desiredStatus: SessionRecord['status'] =
      outcome.kind === 'held'
        ? 'disputed'
        : cancelled
          ? 'cancelled'
          : session.status === 'cancelled' || session.status === 'disputed'
            ? funded && ended(session, now)
              ? 'completed'
              : 'scheduled'
            : session.status;
    // An extra session not charged with its cycle and not charged yet is
    // simply not charged (its own charge is abandoned): no compensation.
    const compensationCents =
      !captured &&
      chargedWithCycle(session) &&
      outcome.kind === 'family_late' &&
      outcome.minutesWorked === 0
        ? applyBps(session.valueCents, policy.lateCancellationHelperBps)
        : captured
          ? session.compensationCents
          : 0;
    const reverting =
      desiredStatus !== session.status &&
      (session.status === 'cancelled' || session.status === 'disputed') &&
      previous === null;
    if (
      session.status !== 'suspended' &&
      !reverting &&
      (desiredStatus !== session.status || compensationCents !== session.compensationCents)
    ) {
      yield* billingRepo.setSessionMoneyState(session.id, {
        from: [session.status],
        status: desiredStatus,
        compensationCents
      });
    }

    const effectBase = {
      sessionId,
      resolutionId: resolution?.id ?? null,
      contractId,
      cycleId: cycle.id,
      outcome: outcome.kind,
      signature,
      appliedAt: now
    };

    // 2. Not charged: the plan (or the capture) follows the status.
    if (!captured) {
      const mechanism =
        outcome.kind === 'none'
          ? 'none'
          : outcome.kind === 'held'
            ? 'held'
            : cycle.status === 'authorised' && chargedWithCycle(session)
              ? 'reduced_capture'
              : 'excluded';
      if (previous?.signature !== signature || previous.mechanism !== mechanism) {
        yield* moneyRepo.applyEffect({
          effect: {
            ...effectBase,
            mechanism,
            familyRefundCents: 0,
            helperOwedCents: compensationCents
          },
          refund: null,
          recovery: null,
          ledger: []
        });
      }
      return mechanism === 'none' ? ('none' as const) : (mechanism as ReconcileResult);
    }

    // 3. Charged: the frozen split decides.
    const charges = ownCharge ? [ownCharge] : yield* ensureCycleSplit(cycle);
    const charge = charges.find((row) => row.sessionId === sessionId);
    if (!charge) {
      // Not in the charge (left out before the capture): nothing to refund.
      if (previous?.signature !== signature) {
        yield* moneyRepo.applyEffect({
          effect: {
            ...effectBase,
            mechanism: 'excluded',
            familyRefundCents: 0,
            helperOwedCents: 0
          },
          refund: null,
          recovery: null,
          ledger: []
        });
      }
      return 'excluded' as const;
    }
    const money = resolveSessionMoney(toSplit(charge), input, policy);
    const refunds = (yield* moneyRepo.listRefunds({ sessionId })).filter(
      (row) => row.status !== 'cancelled'
    );
    const refundedTotal = refunds.reduce((t, row) => t + row.totalCents, 0);
    const delta = money.held ? 0 : money.familyRefund.totalCents - refundedTotal;
    const helper = yield* helperPaidSoFar(sessionId);
    const desiredHelper = money.held ? helper.paid : money.helperOwed.totalCents;
    const overpaid =
      helper.transferred && helper.paid > desiredHelper ? helper.paid - desiredHelper : 0;

    const ledger: Array<BillingLedgerInsert> = [];
    const base = { contractId, cycleId: cycle.id, sessionId };
    const refundKey = `${resolution?.id ?? 'none'}:${outcomeSignature(outcome)}`;
    const refund =
      delta > 0 && resolution !== null
        ? refundRow(money, refunds, delta, {
            refundKey,
            sessionId,
            resolutionId: resolution.id,
            cycleId: cycle.id,
            contractId,
            paymentId: charge.paymentId
          })
        : null;
    if (refund) {
      const key = (suffix: string) => `refund:${refundKey}:${suffix}`;
      ledger.push(
        {
          ...base,
          paymentId: charge.paymentId,
          entryKey: key('care'),
          kind: 'session_refund_care',
          party: 'family',
          amountCents: refund.careCents + refund.careTaxCents
        },
        {
          ...base,
          paymentId: charge.paymentId,
          entryKey: key('fee'),
          kind: 'session_refund_fee',
          party: 'family',
          amountCents: refund.feeCents
        },
        ...refund.feeTaxLines
          .filter((line) => line.taxCents !== 0)
          .map((line) => ({
            ...base,
            paymentId: charge.paymentId,
            entryKey: key(`fee_tax:${line.jurisdiction}:${line.component}`),
            kind: 'session_refund_fee_tax' as const,
            party: 'platform' as const,
            amountCents: line.taxCents,
            label: line.label
          })),
        ...(refund.commissionCents > 0
          ? [
              {
                ...base,
                entryKey: key('commission'),
                kind: 'commission_reversal' as const,
                party: 'platform' as const,
                amountCents: refund.commissionCents
              }
            ]
          : []),
        ...refund.commissionTaxLines
          .filter((line) => line.taxCents !== 0)
          .map((line) => ({
            ...base,
            entryKey: key(`commission_tax:${line.jurisdiction}:${line.component}`),
            kind: 'commission_tax_reversal' as const,
            party: 'platform' as const,
            amountCents: line.taxCents,
            label: line.label
          }))
      );
    }
    if (money.helperOwed.compensationCents > 0 && !money.held) {
      ledger.push({
        ...base,
        entryKey: `compensation:${sessionId}:${signature}`,
        kind: 'cancellation_compensation',
        party: 'provider',
        amountCents: money.helperOwed.compensationCents
      });
    }
    if (delta < 0) {
      // Refunded more than is now owed back: money already returned is
      // never clawed back from the family; Poppynz absorbs it.
      ledger.push({
        ...base,
        entryKey: `absorbed:${sessionId}:${signature}`,
        kind: 'platform_absorbed',
        party: 'platform',
        amountCents: -delta,
        label: 'refunded above the decided outcome'
      });
    }
    const recovery =
      overpaid > 0
        ? {
            recoveryKey: `${signature}:${sessionId}:${helper.paid}`,
            helperUserId: (yield* (yield* ContractRepo).findById(contractId))?.providerUserId ?? '',
            contractId,
            sessionId,
            resolutionId: resolution?.id ?? null,
            amountCents: overpaid
          }
        : null;
    if (recovery) {
      ledger.push({
        ...base,
        entryKey: `recovery:${recovery.recoveryKey}`,
        kind: 'helper_recovery',
        party: 'provider',
        amountCents: overpaid
      });
    }
    const mechanism = money.held
      ? 'held'
      : recovery
        ? 'refund_recovery'
        : refund || refundedTotal > 0
          ? 'refund'
          : 'none';
    const unchanged =
      previous?.signature === signature && refund === null && recovery === null && delta >= 0;
    if (!unchanged) {
      const applied = yield* moneyRepo
        .applyEffect({
          effect: {
            ...effectBase,
            mechanism,
            familyRefundCents: money.familyRefund.totalCents,
            helperOwedCents: money.helperOwed.totalCents
          },
          refund,
          recovery,
          ledger
        })
        .pipe(Effect.either);
      if (Either.isLeft(applied)) {
        const error = applied.left;
        if (error._tag === 'RefundLimitError') {
          yield* refundLimitIncident(cycle, sessionId, error.detail);
          return 'over_limit' as const;
        }
        return yield* Effect.fail(error);
      }
      if (applied.right.refund && applied.right.refundCreated) {
        yield* sendRefund(applied.right.refund, now);
      }
    }
    // A decided session whose pay was already sent short — or not sent at
    // all because it was owed nothing when the cycle's transfer went out (a
    // helper no-show later decided as scheduled): a follow-up transfer pays
    // the rest. Nothing happens before the cycle's first transfer.
    if (!money.held && helper.paid < money.helperOwed.totalCents) {
      yield* ensureFollowUpTransfer(cycle, now);
    }
    return (unchanged && previous ? previous.mechanism : mechanism) as ReconcileResult;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logError(`[money] could not reconcile session ${sessionId}`, error).pipe(
        Effect.as('deferred' as const)
      )
    )
  );

/** The refund row for `delta` more cents back: each component's desired
 * amount minus what earlier refunds of the session returned. */
const refundRow = (
  money: SessionMoney,
  earlier: ReadonlyArray<SessionRefund>,
  delta: number,
  ids: {
    refundKey: string;
    sessionId: string;
    resolutionId: string;
    cycleId: string;
    contractId: string;
    paymentId: string;
  }
) => {
  const care = money.familyRefund.careCents - earlier.reduce((t, r) => t + r.careCents, 0);
  const fee = money.familyRefund.feeCents - earlier.reduce((t, r) => t + r.feeCents, 0);
  const careTaxLines = lineDelta(
    money.familyRefund.careTaxLines,
    earlier.map((r) => r.careTaxLines)
  );
  const feeTaxLines = lineDelta(
    money.familyRefund.feeTaxLines,
    earlier.map((r) => r.feeTaxLines)
  );
  const commissionTaxLines = lineDelta(
    money.commissionReversal.commissionTaxLines,
    earlier.map((r) => r.commissionTaxLines)
  );
  const commission =
    money.commissionReversal.commissionCents - earlier.reduce((t, r) => t + r.commissionCents, 0);
  const consistent =
    care >= 0 &&
    fee >= 0 &&
    commission >= 0 &&
    [...careTaxLines, ...feeTaxLines, ...commissionTaxLines].every((line) => line.taxCents >= 0) &&
    care + sumLines(careTaxLines) + fee + sumLines(feeTaxLines) === delta;
  // A component that moved the other way (a later decision): the whole
  // difference is returned as care, so the total is still exact.
  return consistent
    ? {
        ...ids,
        careCents: care,
        careTaxLines: careTaxLines.filter((line) => line.taxCents > 0),
        careTaxCents: sumLines(careTaxLines),
        feeCents: fee,
        feeTaxLines: feeTaxLines.filter((line) => line.taxCents > 0),
        feeTaxCents: sumLines(feeTaxLines),
        totalCents: delta,
        commissionCents: commission,
        commissionTaxLines: commissionTaxLines.filter((line) => line.taxCents > 0)
      }
    : {
        ...ids,
        careCents: delta,
        careTaxLines: [],
        careTaxCents: 0,
        feeCents: 0,
        feeTaxLines: [],
        feeTaxCents: 0,
        totalCents: delta,
        commissionCents: 0,
        commissionTaxLines: []
      };
};

const refundLimitIncident = (cycle: ContractCycle, sessionId: string, detail: string) =>
  Effect.gen(function* () {
    const recorded = yield* (yield* ContractBillingRepo).recordIncident({
      contractId: cycle.contractId,
      cycleId: cycle.id,
      kind: `refund_limit:${sessionId}`,
      detail
    });
    if (recorded) {
      yield* alertAdmins(
        `A session refund was refused by its limits (contract ${cycle.contractId})`,
        [
          `Session ${sessionId}, cycle ${cycle.index + 1} (${cycleDates(cycle)}): ${detail}.`,
          'Nothing was refunded; check the session’s charge and refunds.'
        ]
      );
    }
  });

// ---------------------------------------------------------------------------
// Refunds at the provider

const refundKeyOf = (refund: SessionRefund) => {
  const retries = refund.noticesSent.filter((notice) => notice.startsWith('retry:')).length;
  return retries === 0 ? refund.id : `${refund.id}-retry-${retries}`;
};

/** Sends a pending refund to the provider (the cycle's charge, our refund
 * id as the key) and settles its answer. A provider error leaves it pending
 * for the next tick under the same key; an open card dispute holds it. */
export const sendRefund = (refund: SessionRefund, now: Date) =>
  Effect.gen(function* () {
    if (refund.status !== 'pending') return refund;
    const moneyRepo = yield* SessionMoneyRepo;
    const payments = yield* Payments;
    const payment = yield* findPaymentRow(refund.paymentId);
    if (payment === null || payment.providerReference === null) return refund;
    if (cardDisputeOpen(payment)) {
      yield* moneyRepo.advanceRefund(refund.id, {
        from: ['pending'],
        set: { failureReason: 'a card dispute is open on this charge — the refund waits' }
      });
      return refund;
    }
    if (cardDisputeLost(payment)) {
      // Tier 3 step 4: the family's bank already returned the disputed money;
      // refunding as well could pay it twice. An admin decides (failure list).
      const held = yield* moneyRepo.advanceRefund(refund.id, {
        from: ['pending'],
        set: {
          status: 'failed',
          failureReason:
            'a card dispute on this charge was lost (the bank returned the money) — check before refunding'
        }
      });
      if (held) {
        yield* alertAdmins(`A refund waits on a lost card dispute (contract ${held.contractId})`, [
          `Refund ${held.id} of ${dollars(held.totalCents)} was not sent: the family's bank already returned the disputed charge.`,
          'It is in the refund-failure list: mark it handled if the chargeback covered it, or retry it.'
        ]);
      }
      return held ?? refund;
    }
    const attempted =
      (yield* moneyRepo.advanceRefund(refund.id, {
        from: ['pending'],
        set: { attempts: refund.attempts + 1 }
      })) ?? refund;
    const result = yield* payments
      .createRefund({
        paymentReference: payment.providerReference,
        amountCents: refund.totalCents,
        idempotencyKey: refundKeyOf(refund),
        metadata: {
          refund_id: refund.id,
          session_id: refund.sessionId,
          cycle_id: refund.cycleId,
          contract_id: refund.contractId,
          resolution_id: refund.resolutionId
        }
      })
      .pipe(Effect.either);
    if (Either.isLeft(result) && result.left.refusal !== undefined) {
      // Refused (not an outage): the same key would be refused again, so it
      // goes to the refund-failure list for an admin.
      const failed = yield* moneyRepo.advanceRefund(refund.id, {
        from: ['pending'],
        set: { status: 'failed', failureReason: result.left.refusal }
      });
      if (failed) yield* refundFailed(failed);
      return failed ?? attempted;
    }
    if (Either.isLeft(result)) {
      yield* Effect.logWarning(`[money] refund ${refund.id} not sent; retrying`, result.left);
      const { refundAlertAfterAttempts } = yield* sessionMoneyPolicy;
      if (attempted.attempts >= refundAlertAfterAttempts) {
        const marked = yield* moneyRepo.appendRefundNotice(refund.id, 'alerted_unreachable');
        if (marked) {
          yield* alertAdmins(`Refund ${refund.id} can't reach the payment provider`, [
            `${attempted.attempts} attempts failed for the session refund of ${dollars(refund.totalCents)} (contract ${refund.contractId}).`,
            'It keeps being retried every tick under the same key.'
          ]);
        }
      }
      return attempted;
    }
    return yield* settleRefund(attempted, result.right, now);
  });

/** Records what the provider says about a refund (from the call, the tick
 * or a webhook — any order, any number of times). */
export const settleRefund = (refund: SessionRefund, provider: ProviderRefund, now: Date) =>
  Effect.gen(function* () {
    const moneyRepo = yield* SessionMoneyRepo;
    if (provider.status === 'succeeded') {
      const done = yield* moneyRepo.advanceRefund(refund.id, {
        from: ['pending', 'failed'],
        set: {
          status: 'succeeded',
          providerReference: provider.reference,
          refundedAt: provider.createdAt ?? now,
          failureReason: null
        }
      });
      if (done) yield* refundNotice(done, 'refund_succeeded');
      return done ?? refund;
    }
    if (provider.status === 'pending') {
      const issued =
        (yield* moneyRepo.advanceRefund(refund.id, {
          from: ['pending'],
          set: { providerReference: provider.reference }
        })) ?? refund;
      yield* refundNotice(issued, 'refund_issued');
      return issued;
    }
    // A refund can fail after it succeeded (verified in test mode with the
    // refundFail card: `succeeded`, then `failed` a minute or two later).
    const failed = yield* moneyRepo.advanceRefund(refund.id, {
      from: ['pending', 'succeeded'],
      set: {
        status: 'failed',
        providerReference: provider.reference,
        failureReason: provider.failureReason ?? `refund ${provider.status} by the provider`
      }
    });
    if (failed) yield* refundFailed(failed);
    return failed ?? refund;
  });

const refundFailed = (failed: SessionRefund) =>
  Effect.gen(function* () {
    yield* refundNotice(failed, 'refund_failed');
    yield* alertAdmins(`A session refund failed (contract ${failed.contractId})`, [
      `Refund ${failed.id} of ${dollars(failed.totalCents)}: ${failed.failureReason}.`,
      'It is in the admin refund-failure list: retry it, or settle it another way and mark it handled.'
    ]);
  });

/** A provider refund event (webhook): re-fetched, matched by its reference
 * or its `refund_id` metadata, settled. */
export const settleSessionRefundByReference = (reference: string, now: Date) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const moneyRepo = yield* SessionMoneyRepo;
    const provider = yield* payments.getRefund(reference);
    const row =
      (yield* moneyRepo.findRefundByProviderReference(reference)) ??
      (provider.metadata.refund_id
        ? yield* moneyRepo.findRefund(provider.metadata.refund_id)
        : null);
    if (!row) return 'unknown refund' as const;
    // Found by its metadata but the row now tracks another provider refund
    // (an admin retried it): this event is about the earlier attempt and
    // must not move the current one (e.g. a late `failed`).
    if (row.providerReference !== null && row.providerReference !== reference) {
      return 'stale refund event' as const;
    }
    const settled = yield* settleRefund(row, provider, now);
    return settled.status;
  });

const refundNotice = (
  refund: SessionRefund,
  kind: 'refund_issued' | 'refund_succeeded' | 'refund_failed'
) =>
  Effect.gen(function* () {
    const moneyRepo = yield* SessionMoneyRepo;
    // One notice of each kind per refund; "issued" is not sent once it
    // already succeeded.
    if (kind === 'refund_issued' && refund.noticesSent.includes('refund_succeeded')) return;
    const marked = yield* moneyRepo.appendRefundNotice(refund.id, kind);
    if (!marked) return;
    const contract = yield* (yield* ContractRepo).findById(refund.contractId);
    const session = (yield* (yield* ContractBillingRepo).listSessions(
      refund.contractId,
      refund.cycleId
    )).find((row) => row.id === refund.sessionId);
    if (!contract) return;
    yield* sendMoneyNotice(kind, {
      contract,
      cycleId: refund.cycleId,
      amountCents: refund.totalCents,
      session: session ? { date: session.date, serviceName: session.serviceName } : null
    });
  });

// ---------------------------------------------------------------------------
// Transfers (spec §8)

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)} CAD`;

/** A follow-up transfer for a cycle whose first transfer went out, unless
 * one is already waiting. */
export const ensureFollowUpTransfer = (cycle: ContractCycle, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const transfers = yield* repo.listTransfers({ cycleId: cycle.id });
    if (transfers.length === 0) return;
    if (transfers.some((row) => ['due', 'paused', 'sending'].includes(row.status))) return;
    const first = transfers.find((row) => row.sequence === 1)!;
    yield* repo.ensureTransfer({
      cycleId: cycle.id,
      contractId: cycle.contractId,
      helperUserId: first.helperUserId,
      sequence: Math.max(...transfers.map((row) => row.sequence)) + 1,
      status: 'due',
      dueAt: now
    });
  });

export type SessionPayable = {
  sessionId: string;
  /** What is still owed for the session now (0 when held or paid). */
  payableCents: number;
  held: boolean;
  money: SessionMoney;
};

/** Each charged session's payable in a cycle: what the policy owes the
 * helper for it, minus what was already sent for it (net of recoveries). */
export const cyclePayables = (cycle: ContractCycle) =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(cycle.contractId);
    const charges = yield* ensureCycleSplit(cycle);
    const sessions = new Map(
      (yield* billingRepo.listSessions(cycle.contractId, cycle.id)).map((s) => [s.id, s])
    );
    const resolutions = yield* (yield* SessionResolutionRepo).listForContract(cycle.contractId);
    // Tier 3 step 4: card disputes hold unpaid pay, and a lost one allocated
    // to the helper takes its forfeit off what they are owed.
    const cardDisputes = yield* (yield* SessionMoneyRepo).listSessionCardDisputes(
      charges.map((charge) => charge.sessionId)
    );
    const payables: Array<SessionPayable> = [];
    for (const charge of charges) {
      const session = sessions.get(charge.sessionId);
      if (!session || !billing) continue;
      const resolution = currentResolution(resolutions, session.id);
      const policy = yield* moneyPolicyFor(resolution);
      const money = resolveSessionMoney(
        toSplit(charge),
        { resolution, session, zone: billing.timeZone },
        policy
      );
      const sent = yield* helperPaidSoFar(session.id);
      const card = cardDisputeHold(cardDisputes, session.id);
      const payable = money.held
        ? 0
        : Math.max(0, owedAfterCardDisputes(money.helperOwed.totalCents, card) - sent.paid);
      const cardHeld = !money.held && card.held && payable > 0;
      payables.push({
        sessionId: session.id,
        held: money.held || cardHeld,
        payableCents: cardHeld ? 0 : payable,
        money: cardHeld ? { ...money, heldCents: { family: 0, helper: payable } } : money
      });
    }
    return payables;
  });

/** Fixes what a transfer pays (its items, the recoveries it deducts) and
 * moves it to `to` — or to `settled` when nothing is due. */
const fixTransfer = (
  transfer: HelperTransfer,
  cycle: ContractCycle,
  to: 'sending' | 'manual_review',
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const payables = yield* cyclePayables(cycle);
    const items: Array<HelperTransferItemInsert> = payables.flatMap(
      (row): Array<HelperTransferItemInsert> =>
        row.held
          ? [{ kind: 'held' as const, sessionId: row.sessionId, amountCents: 0 }]
          : row.payableCents > 0
            ? [
                {
                  kind: 'session' as const,
                  sessionId: row.sessionId,
                  amountCents: row.payableCents
                }
              ]
            : []
    );
    const gross = payables.reduce((t, row) => t + row.payableCents, 0);
    let left = gross;
    const recoveries: Array<{ id: string; fromRecoveredCents: number; recoveredCents: number }> =
      [];
    for (const recovery of yield* repo.listRecoveries({
      helperUserId: transfer.helperUserId,
      statuses: ['outstanding']
    })) {
      if (left === 0) break;
      const take = Math.min(left, recovery.amountCents - recovery.recoveredCents);
      if (take <= 0) continue;
      left -= take;
      recoveries.push({
        id: recovery.id,
        fromRecoveredCents: recovery.recoveredCents,
        recoveredCents: recovery.recoveredCents + take
      });
      items.push({ kind: 'recovery', recoveryId: recovery.id, amountCents: -take });
    }
    const recovered = gross - left;
    const amount = gross - recovered;
    const base = { contractId: cycle.contractId, cycleId: cycle.id };
    return yield* repo.fixTransfer(transfer.id, {
      from: [transfer.status],
      set: {
        status: amount === 0 ? 'settled' : to,
        grossCents: gross,
        recoveredCents: recovered,
        amountCents: amount,
        fixedAt: now
      },
      items,
      recoveries,
      ledger: [
        ...payables
          .filter((row) => row.held)
          .map((row) => ({
            ...base,
            sessionId: row.sessionId,
            entryKey: `transfer:${transfer.id}:held:${row.sessionId}`,
            kind: 'transfer_held' as const,
            party: 'provider' as const,
            amountCents: row.money.heldCents?.helper ?? 0
          }))
      ]
    });
  });

/** `source_reference` of a transfer sent from the platform balance (no
 * `source_transaction`). */
export const PLATFORM_BALANCE_SOURCE = 'platform_balance';

/**
 * The transfer's source: the cycle's charge (`ch_…`) when the amount fits
 * under it, else the platform balance. Stripe caps the transfers made from
 * a charge at what it took minus its refunds and the transfers already made
 * from it (verified in test mode), so a follow-up that pays a session whose
 * refund was absorbed (decided as scheduled after a full refund) can't come
 * from the charge. `undefined` when the provider can't be reached: the
 * transfer waits for the next tick rather than go out without its source.
 */
const sourceOf = (transfer: HelperTransfer, cycle: ContractCycle) =>
  Effect.gen(function* () {
    // Tier 3 step 3: a transfer paying only extra sessions charged on one
    // payment of their own (a follow-up after the cycle's transfer) is
    // sourced from that charge; otherwise from the cycle's.
    const items = (yield* (yield* SessionMoneyRepo).listTransferItems({
      transferIds: [transfer.id]
    })).filter((item) => item.kind === 'session');
    const charges = yield* (yield* ContractBillingRepo).listSessionCharges(
      cycle.contractId,
      cycle.id
    );
    const sources = new Set(
      items.map(
        (item) => charges.find((row) => row.sessionId === item.sessionId)?.paymentId ?? null
      )
    );
    const only = sources.size === 1 ? [...sources][0]! : null;
    const payment = yield* findPaymentRow(only ?? cycle.paymentId);
    if (!payment?.providerReference) return PLATFORM_BALANCE_SOURCE;
    const fetched = yield* (yield* Payments)
      .getPayment(payment.providerReference)
      .pipe(Effect.either);
    if (Either.isLeft(fetched)) return undefined;
    const charge = fetched.right.chargeReference;
    if (charge === null) return PLATFORM_BALANCE_SOURCE;
    const earlier = (yield* (yield* SessionMoneyRepo).listTransfers({ cycleId: cycle.id }))
      .filter(
        (row) =>
          row.id !== transfer.id && row.providerReference !== null && row.sourceReference === charge
      )
      .reduce((total, row) => total + (row.amountCents ?? 0), 0);
    const left = fetched.right.receivedCents - fetched.right.refundedCents - earlier;
    return (transfer.amountCents ?? 0) <= left ? charge : PLATFORM_BALANCE_SOURCE;
  });

const transferKey = (transfer: HelperTransfer) => {
  const base =
    transfer.sequence === 1
      ? `transfer-${transfer.cycleId}`
      : `transfer-${transfer.cycleId}-${transfer.sequence}`;
  const retries = transfer.noticesSent.filter((notice) => notice.startsWith('retry:')).length;
  return retries === 0 ? base : `${base}-retry-${retries}`;
};

/** Sends a fixed transfer under its key (the cycle id): a provider error
 * leaves it `sending` for the next tick (same key, never a second
 * transfer); a refusal fails it for an admin. */
const sendTransfer = (
  transfer: HelperTransfer,
  cycle: ContractCycle,
  contract: Contract,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const payments = yield* Payments;
    const account = yield* (yield* PayoutAccountRepo).findByUserId(transfer.helperUserId);
    if (!account) return transfer;
    // The source is chosen once and kept: a retry under the same key must
    // send the same request.
    const source = transfer.sourceReference ?? (yield* sourceOf(transfer, cycle));
    if (source === undefined) return transfer;
    if (transfer.sourceReference === null) {
      const kept = yield* repo.advanceTransfer(transfer.id, {
        from: ['sending'],
        set: { sourceReference: source }
      });
      if (!kept) return transfer;
    }
    const result = yield* payments
      .createTransfer({
        amountCents: transfer.amountCents ?? 0,
        currency: 'CAD',
        destination: account.accountReference,
        sourceTransaction: source === PLATFORM_BALANCE_SOURCE ? null : source,
        idempotencyKey: transferKey(transfer),
        metadata: {
          transfer_id: transfer.id,
          cycle_id: cycle.id,
          contract_id: cycle.contractId,
          sequence: String(transfer.sequence)
        },
        description: `Poppynz care · ${cycleDates(cycle)}`
      })
      .pipe(Effect.either);
    if (Either.isLeft(result)) {
      yield* Effect.logWarning(`[money] transfer ${transfer.id} not sent; retrying`, result.left);
      yield* repo.advanceTransfer(transfer.id, {
        from: ['sending'],
        set: { attempts: transfer.attempts + 1, sourceReference: source }
      });
      return transfer;
    }
    if (result.right.status === 'refused') {
      const failed = yield* repo.advanceTransfer(transfer.id, {
        from: ['sending'],
        set: { status: 'failed', failureReason: result.right.reason, sourceReference: source }
      });
      if (failed) {
        yield* alertAdmins(`A transfer to a helper was refused (contract ${cycle.contractId})`, [
          `Transfer ${failed.id} of ${dollars(failed.amountCents ?? 0)} for cycle ${cycle.index + 1} (${cycleDates(cycle)}): ${result.right.reason}.`,
          'It is in the admin payout queue: retry it, or pay it manually.'
        ]);
      }
      return failed ?? transfer;
    }
    const sent = yield* repo.advanceTransfer(transfer.id, {
      from: ['sending'],
      set: {
        status: 'sent',
        providerReference: result.right.transfer.reference,
        sourceReference: source,
        sentAt: now,
        failureReason: null
      }
    });
    if (sent) {
      yield* (yield* ContractBillingRepo).appendLedger([
        {
          contractId: cycle.contractId,
          cycleId: cycle.id,
          entryKey: `transfer:${sent.id}`,
          kind: 'transfer',
          party: 'provider',
          amountCents: sent.amountCents ?? 0,
          label: result.right.transfer.reference
        }
      ]);
      const items = yield* repo.listTransferItems({ transferIds: [sent.id] });
      if (yield* repo.appendTransferNotice(sent.id, 'transfer_sent')) {
        yield* sendMoneyNotice('transfer_sent', {
          contract,
          cycleId: cycle.id,
          amountCents: sent.amountCents ?? 0,
          cycleDates: { startsOn: cycle.startsOn, endsOn: cycle.endsOn },
          heldSessions: items.filter((item) => item.kind === 'held').length
        });
      }
    }
    return sent ?? transfer;
  });

const DAY_MS = 24 * 60 * 60 * 1000;

/** One transfer's step: due → (paused | sending | settled) → sent. */
export const processTransfer = (transfer: HelperTransfer, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const cycle = (yield* (yield* ContractBillingRepo).listCycles(transfer.contractId)).find(
      (row) => row.id === transfer.cycleId
    );
    const contract = yield* (yield* ContractRepo).findById(transfer.contractId);
    if (!cycle || !contract) return transfer;
    if (transfer.status === 'sending') return yield* sendTransfer(transfer, cycle, contract, now);
    if (transfer.status !== 'due' && transfer.status !== 'paused') return transfer;
    if (now < transfer.dueAt) return transfer;
    const readiness = yield* paymentReadiness(transfer.helperUserId);
    // Never treated as restricted: the next tick asks again.
    if (readiness === 'unknown') return transfer;
    if (readiness === 'not_ready') {
      const { manualPayoutAfterDays } = yield* sessionMoneyPolicy;
      const paused =
        transfer.status === 'due'
          ? ((yield* repo.advanceTransfer(transfer.id, {
              from: ['due'],
              set: { status: 'paused' }
            })) ?? transfer)
          : transfer;
      if (yield* repo.appendTransferNotice(paused.id, 'transfer_held')) {
        yield* sendMoneyNotice('transfer_held', {
          contract,
          cycleId: cycle.id,
          amountCents: 0,
          cycleDates: { startsOn: cycle.startsOn, endsOn: cycle.endsOn },
          heldReason: 'payout_account'
        });
        yield* alertAdmins(
          `Helper transfer paused: payout account not ready (contract ${cycle.contractId})`,
          [
            `Cycle ${cycle.index + 1} (${cycleDates(cycle)}): the helper's payout account is restricted or not ready, so their transfer is paused.`,
            `It moves to the manual payout queue after ${manualPayoutAfterDays} days if it still can't be sent.`
          ]
        );
      }
      if (now.getTime() >= paused.dueAt.getTime() + manualPayoutAfterDays * DAY_MS) {
        const queued = yield* fixTransfer(paused, cycle, 'manual_review', now);
        if (
          queued?.status === 'manual_review' &&
          (yield* repo.appendTransferNotice(queued.id, 'manual_review'))
        ) {
          yield* alertAdmins(`Manual payout needed (contract ${cycle.contractId})`, [
            `Transfer ${queued.id} of ${dollars(queued.amountCents ?? 0)} for cycle ${cycle.index + 1} (${cycleDates(cycle)}) could not be sent for ${manualPayoutAfterDays} days.`,
            'It is in the manual payout queue: verify the recipient, pay it, record it and have another admin approve it.'
          ]);
        }
        return queued ?? paused;
      }
      return paused;
    }
    const fixed = yield* fixTransfer(transfer, cycle, 'sending', now);
    if (!fixed) return transfer;
    if (fixed.status === 'settled') return fixed;
    return yield* sendTransfer(fixed, cycle, contract, now);
  });

export type MoneyTickSummary = {
  reconciled: number;
  refundsSent: number;
  transfers: number;
  failed: number;
};

/** The tick's money step (worker and dev clock): every session with a
 * resolution is reconciled, pending refunds are (re)sent, transfers that
 * are due are created and processed. Each item is isolated. `contractId`
 * limits it to one contract (the admin billing fast-forward). */
export const runSessionMoneyTick = (now: Date, options: { contractId?: string } = {}) =>
  Effect.gen(function* () {
    const summary: MoneyTickSummary = { reconciled: 0, refundsSent: 0, transfers: 0, failed: 0 };
    const resolutionRepo = yield* SessionResolutionRepo;
    const moneyRepo = yield* SessionMoneyRepo;
    const inScope = (contractId: string | null) =>
      !options.contractId || contractId === options.contractId;
    const contractFilter = options.contractId ? { contractId: options.contractId } : {};
    const all = yield* resolutionRepo.listByStatus([
      'proposed',
      'confirmed',
      'contested',
      'decided',
      'lapsed',
      'reversed'
    ]);
    const sessions = new Map(
      all.filter((row) => inScope(row.contractId)).map((row) => [row.sessionId, row.contractId])
    );
    for (const [sessionId, contractId] of sessions) {
      const result = yield* reconcileSession(contractId, sessionId, now);
      if (result !== 'none' && result !== 'no_billing') summary.reconciled += 1;
    }
    for (const refund of yield* moneyRepo.listRefunds({
      statuses: ['pending'],
      ...contractFilter
    })) {
      const exit = yield* sendRefund(refund, now).pipe(Effect.exit);
      if (exit._tag === 'Failure') summary.failed += 1;
      else summary.refundsSent += 1;
    }
    const dueForTransfer = (yield* moneyRepo.listCyclesDueForTransfer(now)).filter((due) =>
      inScope(due.cycle.contractId)
    );
    for (const due of dueForTransfer) {
      yield* moneyRepo.ensureTransfer({
        cycleId: due.cycle.id,
        contractId: due.cycle.contractId,
        helperUserId: due.helperUserId,
        sequence: 1,
        status: 'due',
        dueAt: due.cycle.transferAt
      });
    }
    for (const transfer of yield* moneyRepo.listTransfers({
      statuses: ['due', 'paused', 'sending'],
      ...contractFilter
    })) {
      const exit = yield* processTransfer(transfer, now).pipe(Effect.exit);
      if (exit._tag === 'Failure') {
        summary.failed += 1;
        yield* Effect.logError(`[money] transfer ${transfer.id} failed`, exit.cause);
      } else summary.transfers += 1;
    }
    return summary;
  });

// ---------------------------------------------------------------------------
// Admin actions: the manual payout queue and the refund-failure list. Every
// one is audited (billing_audit_events).

export type MoneyAdminRefusal =
  | 'not_found'
  /** The transfer isn't in the manual queue (or failed). */
  | 'not_payable'
  /** A manual payout records exactly the transfer's fixed amount. */
  | 'amount_mismatch'
  | 'already_recorded'
  | 'already_decided'
  /** Approval needs a second admin. */
  | 'same_admin'
  /** Only a failed refund (or transfer) can be retried or handled. */
  | 'not_failed';

export class MoneyAdminError extends Data.TaggedError('MoneyAdminError')<{
  reason: MoneyAdminRefusal;
}> {}

const refuseAdmin = (reason: MoneyAdminRefusal) => Effect.fail(new MoneyAdminError({ reason }));

const snapshot = (row: unknown) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

/** An admin records a payout made outside the provider (method, reference,
 * amount, reason). It settles nothing until another admin approves it. */
export const recordManualPayout = (
  input: {
    transferId: string;
    method: string;
    reference: string;
    amountCents: number;
    reason: string;
  },
  actorUserId: string,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const transfer = yield* repo.findTransfer(input.transferId);
    if (!transfer) return yield* refuseAdmin('not_found');
    if (transfer.status !== 'manual_review' && transfer.status !== 'failed') {
      return yield* refuseAdmin('not_payable');
    }
    if (transfer.amountCents !== input.amountCents) return yield* refuseAdmin('amount_mismatch');
    const row = yield* repo.recordManualPayout(
      {
        transferId: transfer.id,
        helperUserId: transfer.helperUserId,
        amountCents: input.amountCents,
        method: input.method,
        reference: input.reference,
        reason: input.reason,
        recordedByUserId: actorUserId,
        recordedAt: now
      },
      {
        entity: 'manual_payout',
        entityId: transfer.id,
        action: 'recorded',
        actorUserId,
        note: input.reason,
        before: snapshot(transfer)
      }
    );
    if (!row) return yield* refuseAdmin('already_recorded');
    return row;
  });

/** A second admin approves (the transfer is settled for good, never also
 * sent through the provider) or rejects a recorded manual payout. */
export const decideManualPayout = (
  id: string,
  decision: 'approved' | 'rejected',
  actorUserId: string,
  note: string | null,
  now: Date
) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const pending = (yield* repo.listManualPayouts({})).find((row) => row.id === id);
    if (!pending) return yield* refuseAdmin('not_found');
    if (pending.status !== 'pending_approval') return yield* refuseAdmin('already_decided');
    if (decision === 'approved' && pending.recordedByUserId === actorUserId) {
      return yield* refuseAdmin('same_admin');
    }
    const transfer = yield* repo.findTransfer(pending.transferId);
    const decided = yield* repo.decideManualPayout(
      id,
      {
        decision,
        actorUserId,
        note,
        at: now,
        ledger:
          transfer && decision === 'approved'
            ? [
                {
                  contractId: transfer.contractId,
                  cycleId: transfer.cycleId,
                  entryKey: `manual_payout:${id}`,
                  kind: 'manual_payout',
                  party: 'provider',
                  amountCents: pending.amountCents,
                  label: `${pending.method} ${pending.reference}`
                }
              ]
            : []
      },
      {
        entity: 'manual_payout',
        entityId: id,
        action: decision,
        actorUserId,
        note,
        before: snapshot(pending)
      }
    );
    if (!decided) return yield* refuseAdmin('already_decided');
    return decided;
  });

/** An admin sends a refused transfer again (a new key: the refusal under
 * the old one would be replayed). */
export const retryTransfer = (id: string, actorUserId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const transfer = yield* repo.findTransfer(id);
    if (!transfer) return yield* refuseAdmin('not_found');
    if (transfer.status !== 'failed') return yield* refuseAdmin('not_failed');
    const retries = transfer.noticesSent.filter((n) => n.startsWith('retry:')).length;
    yield* repo.appendTransferNotice(id, `retry:${retries + 1}`);
    // The source is chosen again (a new key may send a new request): a
    // refusal by the charge's cap goes out from the balance this time.
    const moved = yield* repo.advanceTransfer(id, {
      from: ['failed'],
      set: { status: 'sending', failureReason: null, sourceReference: null }
    });
    if (!moved) return yield* refuseAdmin('not_failed');
    yield* repo.appendAudit({
      entity: 'helper_transfer',
      entityId: id,
      action: 'retried',
      actorUserId,
      before: snapshot(transfer),
      after: snapshot(moved)
    });
    return yield* processTransfer(moved, now);
  });

/** An admin retries a failed refund (a new key: the failure under the old
 * one would be replayed). */
export const retryRefund = (id: string, actorUserId: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const refund = yield* repo.findRefund(id);
    if (!refund) return yield* refuseAdmin('not_found');
    if (refund.status !== 'failed') return yield* refuseAdmin('not_failed');
    const retries = refund.noticesSent.filter((n) => n.startsWith('retry:')).length;
    yield* repo.appendRefundNotice(id, `retry:${retries + 1}`);
    const moved = yield* repo.advanceRefund(id, {
      from: ['failed'],
      set: { status: 'pending', failureReason: null, providerReference: null }
    });
    if (!moved) return yield* refuseAdmin('not_failed');
    yield* repo.appendAudit({
      entity: 'session_refund',
      entityId: id,
      action: 'retried',
      actorUserId,
      before: snapshot(refund),
      after: snapshot(moved)
    });
    return yield* sendRefund(moved, now);
  });

/** An admin (or the accountant) settled a failed refund another way: it
 * leaves the failure list, with who did it and how. */
export const markRefundHandled = (id: string, actorUserId: string, note: string, now: Date) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const refund = yield* repo.findRefund(id);
    if (!refund) return yield* refuseAdmin('not_found');
    if (refund.status !== 'failed') return yield* refuseAdmin('not_failed');
    const moved = yield* repo.advanceRefund(id, {
      from: ['failed'],
      // Tier 3 step 5: dated, so the tax report counts it as refunded in the
      // month it was marked (spec §13.2).
      set: {
        status: 'cancelled',
        resolvedByUserId: actorUserId,
        resolvedNote: note,
        handledAt: now
      }
    });
    if (!moved) return yield* refuseAdmin('not_failed');
    yield* repo.appendAudit({
      entity: 'session_refund',
      entityId: id,
      action: 'handled',
      actorUserId,
      note,
      before: snapshot(refund),
      after: snapshot({ ...moved, handledAt: now })
    });
    return moved;
  });

/** A connected account's payout event: re-fetched; a paid payout marks the
 * helper's transfers it paid out as arrived — EXACTLY from the payout's own
 * balance transactions when it is an automatic payout (Tier 3 step 5,
 * §13.4), else (a manual payout, or the listing failed) APPROXIMATELY: the
 * transfers sent before it, labelled so. A failed one alerts. */
export const handlePayoutEvent = (account: string, reference: string) =>
  Effect.gen(function* () {
    const payout = yield* (yield* Payments).getPayout({ account, reference });
    const owner = yield* (yield* PayoutAccountRepo).findByReference(account);
    if (!owner) return 'unknown account' as const;
    if (payout.status === 'paid') {
      const { maxPages, pageSize } = yield* reconciliationConfig;
      const exact = yield* matchPayoutExactly(account, payout, maxPages, pageSize);
      if (exact) return `paid: ${exact.moved} transfer(s) arrived (exact)` as const;
      const moved = yield* (yield* SessionMoneyRepo).markHelperTransfersPaid(
        owner.userId,
        payout.createdAt,
        payout.arrivalDate ?? payout.createdAt,
        payout.reference
      );
      return `paid: ${moved} transfer(s) arrived (approximate)` as const;
    }
    if (payout.status === 'failed') {
      yield* alertAdmins(`A helper's bank payout failed (${account})`, [
        `Payout ${reference} of ${dollars(payout.amountCents)}: ${payout.failureReason ?? 'no reason given'}.`,
        'The money stays in their Stripe balance; they need to fix their bank details in Payouts.'
      ]);
      return 'failed' as const;
    }
    return payout.status;
  });

// ---------------------------------------------------------------------------
// Previews and views

export type MoneyPreview = {
  outcome: MoneyOutcome['kind'];
  /** Whether the cycle's money has been taken (a refund) or not yet (a
   * smaller charge). */
  charged: boolean;
  /** What goes back to the family (or, before the charge, is not taken). */
  familyBackCents: number;
  /** What the family still pays for the session. */
  familyPaysCents: number;
  /** What the helper receives for the session. */
  helperReceivesCents: number;
  held: boolean;
};

/** "Cancelling now: Hana receives $15.63, you get $50.39 back" — what a
 * resolution would do to the session's money, computed by the policy
 * function from the frozen (or provisional) split. Null when the session
 * isn't charged (or can't be priced). */
export const previewSessionMoney = (
  contractId: string,
  sessionId: string,
  hypothetical: NonNullable<Parameters<typeof resolveSessionMoney>[1]['resolution']>
) =>
  Effect.gen(function* () {
    const billingRepo = yield* ContractBillingRepo;
    const billing = yield* billingRepo.findBilling(contractId);
    const session = (yield* billingRepo.listSessions(contractId)).find((s) => s.id === sessionId);
    if (!billing || !session) return null;
    const cycle = (yield* billingRepo.listCycles(contractId)).find((c) => c.id === session.cycleId);
    if (!cycle) return null;
    const split = yield* provisionalCycleSplit(cycle);
    const charge = split.charges.find((row) => row.sessionId === sessionId);
    if (!charge) return null;
    const taken = split.charged || split.ownCharged.includes(sessionId);
    const policy = yield* moneyPolicyFor({ policyVersion: null });
    const money = resolveSessionMoney(
      toSplit(charge),
      { resolution: hypothetical, session, zone: billing.timeZone },
      policy
    );
    return {
      outcome: money.outcome,
      charged: taken,
      familyBackCents: money.familyRefund.totalCents,
      familyPaysCents: money.held ? charge.familyTotalCents : money.familyNetCents,
      helperReceivesCents: money.held ? 0 : money.helperOwed.totalCents,
      held: money.held
    } satisfies MoneyPreview;
  });

export type SessionMoneyView = {
  /** How the resolution was applied (excluded, reduced_capture, refund,
   * refund_recovery, held, none), or null with none. */
  mechanism: string | null;
  refunds: Array<{
    id: string;
    status: SessionRefund['status'];
    totalCents: number;
    refundedAt: string | null;
  }>;
  /** The helper's transfer of this session (latest), or null before. */
  transfer: {
    status: HelperTransfer['status'];
    amountCents: number;
    held: boolean;
  } | null;
};

/** Each session's money state for the cycle page (refund and transfer
 * status per row). */
export const cycleSessionMoney = (contractId: string, sessionIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const repo = yield* SessionMoneyRepo;
    const effects = new Map(
      (yield* repo.listEffects(contractId)).map((row) => [row.sessionId, row])
    );
    const refunds = yield* repo.listRefunds({ contractId });
    const items = yield* repo.listTransferItems({ sessionIds });
    const transfers = new Map(
      (yield* repo.listTransfers({ contractId })).map((row) => [row.id, row])
    );
    return new Map(
      sessionIds.map((sessionId) => {
        const latest = items.filter((item) => item.sessionId === sessionId).at(-1);
        const transfer = latest ? transfers.get(latest.transferId) : undefined;
        return [
          sessionId,
          {
            mechanism: effects.get(sessionId)?.mechanism ?? null,
            refunds: refunds
              .filter((row) => row.sessionId === sessionId)
              .map((row) => ({
                id: row.id,
                status: row.status,
                totalCents: row.totalCents,
                refundedAt: row.refundedAt?.toISOString() ?? null
              })),
            transfer:
              latest && transfer
                ? {
                    status: transfer.status,
                    amountCents: latest.amountCents,
                    held: latest.kind === 'held'
                  }
                : null
          } satisfies SessionMoneyView
        ] as const;
      })
    );
  });
