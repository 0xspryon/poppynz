import type { SqlError } from '@effect/sql/SqlError';
import {
  BillingCustomerRepo,
  CheckOrderRepo,
  PaymentRepo,
  type DBNotFoundError,
  type Payment
} from '@repo/db';
import { publishNotificationBestEffort } from '@repo/notify';
import { Payments, type PaymentProviderError, type ProviderPayment } from '@repo/payments';
import { SafetyVerificationQueue } from '@repo/queue';
import { Context, Effect, Option } from 'effect';
import { saveCard } from './cards';

/**
 * settle(paymentId): the ONE path that records money as taken or not.
 *
 * Three callers reach it — the browser's confirm request, the Stripe webhook
 * and the worker's recovery job — in any order and possibly at once. It never
 * trusts the caller: it re-fetches the payment from the provider, checks the
 * fetched object against our row, and applies the outcome with compare-and-set
 * writes, so each outcome lands exactly once whoever gets there first.
 */

export type SettleResult =
  /** This call recorded the capture and moved the order on. */
  | { outcome: 'captured'; payment: Payment }
  /** This call recorded the failure and returned the order to the basket. */
  | { outcome: 'failed'; payment: Payment }
  /** The provider has not finished (3-D Secure, processing): nothing changed. */
  | { outcome: 'pending'; payment: Payment }
  /** Already settled by an earlier or concurrent caller. */
  | { outcome: 'final'; payment: Payment }
  /** The fetched object does not match our row; flagged, nothing else done. */
  | { outcome: 'mismatch'; payment: Payment; reason: string }
  /** Recorded under another provider than the active one; left alone. */
  | { outcome: 'skipped'; payment: Payment }
  /** A contract-cycle hold was placed (captured later). */
  | { outcome: 'authorised'; payment: Payment };

/**
 * The contract-cycle branch of settle (piece 3), provided by contract
 * billing. Optional so the check-order callers keep their own environment;
 * the API and worker runtimes always provide it (`CycleSettlementLive`).
 */
export class CycleSettlement extends Context.Tag('@repo/billing/CycleSettlement')<
  CycleSettlement,
  {
    settle: (
      row: Payment,
      now: Date
    ) => Effect.Effect<
      { outcome: string; payment: Payment },
      SqlError | DBNotFoundError | PaymentProviderError
    >;
  }
>() {}

const settleContractCycle = (row: Payment, now: Date) =>
  Effect.gen(function* () {
    const settlement = yield* Effect.serviceOption(CycleSettlement);
    if (Option.isNone(settlement)) {
      yield* Effect.logWarning(`[billing] no cycle settlement here; left ${row.id} for the worker`);
      return { outcome: 'pending' as const, payment: row };
    }
    const settled = yield* settlement.value.settle(row, now);
    switch (settled.outcome) {
      case 'authorised':
        return { outcome: 'authorised' as const, payment: settled.payment };
      case 'captured':
        return { outcome: 'captured' as const, payment: settled.payment };
      case 'declined':
      case 'lost_hold':
        return { outcome: 'failed' as const, payment: settled.payment };
      case 'final':
        return { outcome: 'final' as const, payment: settled.payment };
      case 'skipped':
        return { outcome: 'skipped' as const, payment: settled.payment };
      case 'mismatch':
        return {
          outcome: 'mismatch' as const,
          payment: settled.payment,
          reason: settled.payment.lastError ?? 'mismatch'
        };
      default:
        return { outcome: 'pending' as const, payment: settled.payment };
    }
  });

/** Statuses after which a payment row never moves again here. `authorised`
 * rows are the pre-Stripe mock's settled charges. */
const finalStatuses: ReadonlyArray<Payment['status']> = [
  'captured',
  'authorised',
  'refunded',
  'failed'
];

/** Every check the spec asks for, in order. Null when the fetched intent is
 * ours and for the amount we priced. */
export const mismatchReason = (row: Payment, fetched: ProviderPayment): string | null => {
  if (fetched.metadata.payment_id !== row.id) {
    return `provider payment ${fetched.reference} belongs to ${fetched.metadata.payment_id ?? 'nobody'}, not ${row.id}`;
  }
  if (fetched.amountCents !== row.totalCents) {
    return `provider amount ${fetched.amountCents} does not match ${row.totalCents}`;
  }
  if (fetched.currency.toLowerCase() !== row.currency.toLowerCase()) {
    return `provider currency ${fetched.currency} does not match ${row.currency}`;
  }
  return null;
};

/** The order the payment paid for moves to `paid` and is handed to the
 * worker. Safe to repeat: an order already past `payment_pending` is left
 * alone, and a `paid` one is re-enqueued (the queue dedupes on the order). */
const finishOrder = (payment: Payment, at: Date) =>
  Effect.gen(function* () {
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const queue = yield* SafetyVerificationQueue;

    const order = yield* orders.findByPaymentId(payment.id);
    if (order !== null && order.status === 'paid') {
      yield* queue.enqueueOrder({ orderId: order.id });
      return;
    }
    if (order !== null && order.status !== 'payment_pending') {
      return;
    }
    const paid =
      order === null
        ? null
        : yield* orders.advance(order.id, {
            from: { status: 'payment_pending', paymentId: payment.id },
            set: { status: 'paid', consentAt: order.consentAt ?? at }
          });
    if (paid === null) {
      const current = yield* orders.findByPaymentId(payment.id);
      if (current !== null && current.status !== 'payment_pending') return;
      // Money was taken and no order is waiting for it. Never silent: the
      // payment carries the note so somebody settles it by hand.
      yield* paymentRepo.update(payment.id, {
        lastError:
          'charge settled but the order was no longer awaiting it — needs manual settlement'
      });
      return;
    }
    // Placing the order happens in the worker so a Credibled outage is a
    // retry rather than a lost payment.
    yield* queue.enqueueOrder({ orderId: paid.id });
    yield* publishNotificationBestEffort(paid.userId, {
      type: 'safety_verification.updated',
      payload: { status: 'payment_pending' }
    });
  });

/** A family's first payment saves its card (`savesCard`). Only for the
 * customer the payment's own user holds — never someone else's — and only
 * into an empty slot: the intent asked to save because no card was on file
 * when it started, so a card on file now was added since and is newer. Safe
 * to repeat (the same card is a no-op). */
const rememberCard = (payment: Payment, fetched: ProviderPayment) =>
  Effect.gen(function* () {
    if (!fetched.savesCard || fetched.paymentMethod === null || fetched.customer === null) {
      return;
    }
    const repo = yield* BillingCustomerRepo;
    const payments = yield* Payments;
    const owner = yield* repo.findByCustomerReference(payments.provider, fetched.customer);
    if (owner === null || owner.userId !== payment.userId) return;
    yield* saveCard(owner.userId, fetched.paymentMethod, 'fill');
  }).pipe(
    // The charge is recorded; a card we failed to remember can be re-added
    // in Billing. Failing here would only make the webhook retry forever.
    Effect.catchAll((error) => Effect.logWarning(`could not save card for ${payment.id}`, error))
  );

/** Back to the basket so the applicant can pay again with a fresh charge.
 * Guarded on OUR payment so it can never clobber a re-claim — and safe to
 * repeat: an order already moved past `payment_pending` (or re-claimed by a
 * different payment) is left alone. Called both right after a payment lands
 * `failed` and, later, whenever a row already `failed` is revisited and the
 * revert never ran (a crash between the two writes, or a losing CAS on a
 * concurrent `fail`). */
const revertOrder = (payment: Payment) =>
  Effect.gen(function* () {
    const orders = yield* CheckOrderRepo;
    const order = yield* orders.findByPaymentId(payment.id);
    if (order === null) return;
    const reverted = yield* orders.advance(order.id, {
      from: { status: 'payment_pending', paymentId: payment.id },
      set: { status: 'draft', paymentId: null }
    });
    if (reverted !== null) {
      yield* publishNotificationBestEffort(reverted.userId, {
        type: 'safety_verification.updated',
        payload: { status: 'not_started' }
      });
    }
  });

/** Runs whichever payment's own follow-up belongs to the status it actually
 * landed in — the one piece of recovery logic shared by a losing CAS (the
 * row already moved under us) and by a row that was already final when
 * `settleRow` started (a crash left the first write's follow-up unrun). */
const runFollowUp = (payment: Payment, at: Date) =>
  payment.status === 'captured' || payment.status === 'authorised'
    ? finishOrder(payment, at)
    : payment.status === 'failed'
      ? revertOrder(payment)
      : Effect.void;

const capture = (row: Payment, fetched: ProviderPayment, at: Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const captured = yield* paymentRepo.advance(row.id, {
      from: 'pending',
      set: { status: 'captured', capturedAt: at, receiptUrl: fetched.receiptUrl, lastError: null }
    });
    if (captured === null) {
      // Lost the CAS: something else already moved this row. If that
      // something was itself a capture, its own follow-up is expected to
      // have run finishOrder already — but a crash between the two writes
      // would otherwise leave the order stuck in payment_pending forever
      // (the webhook is already acknowledged, and neither the stale-pending
      // sweep nor the awaiting-placement sweep will ever look at a captured
      // payment again). Re-running it here is idempotent either way.
      // The card is ours to remember too: the winner may have crashed
      // before doing it, and only a caller holding the fetched intent can.
      const current = yield* paymentRepo.findById(row.id);
      if (current.status === 'captured') yield* rememberCard(current, fetched);
      yield* runFollowUp(current, at);
      return { outcome: 'final' as const, payment: current };
    }
    // Before finishOrder: if handing the order on fails, the retry reaches
    // this row through the final-status branch, which no longer has the
    // fetched intent to save the card from.
    yield* rememberCard(captured, fetched);
    yield* finishOrder(captured, at);
    return { outcome: 'captured' as const, payment: captured };
  });

const fail = (row: Payment, reason: string) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const failed = yield* paymentRepo.advance(row.id, {
      from: 'pending',
      set: { status: 'failed', lastError: reason }
    });
    if (failed === null) {
      // Lost the CAS. Only run the revert ourselves if the row that won is
      // ALSO failed (another caller's fail beat us to it, and its own revert
      // may have crashed before running) — a row that was captured instead
      // is the capturing caller's own follow-up to run, never ours to touch.
      const current = yield* paymentRepo.findById(row.id);
      if (current.status === 'failed') {
        yield* revertOrder(current);
      }
      return { outcome: 'final' as const, payment: current };
    }
    yield* revertOrder(failed);
    return { outcome: 'failed' as const, payment: failed };
  });

const settleRow = (row: Payment, now: () => Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;

    // Contract billing holds and captures: their own follow-ups (a hold is
    // not final, and there is no order to finish).
    if (row.kind === 'contract_cycle') {
      return (yield* settleContractCycle(row, now())) as SettleResult;
    }

    if (finalStatuses.includes(row.status)) {
      // Whichever follow-up never ran (a crash between the two writes) is
      // finished here; otherwise this is a no-op (`refunded` has none).
      yield* runFollowUp(row, now());
      return { outcome: 'final' as const, payment: row };
    }
    if (row.provider !== payments.provider) {
      return { outcome: 'skipped' as const, payment: row };
    }
    if (row.providerReference === null) {
      // The provider was never reached; the order route retries the start.
      return { outcome: 'pending' as const, payment: row };
    }

    const fetched = yield* payments.getPayment(row.providerReference);
    const mismatch = mismatchReason(row, fetched);
    if (mismatch !== null) {
      const flagged = yield* paymentRepo.update(row.id, { lastError: mismatch });
      return { outcome: 'mismatch' as const, payment: flagged, reason: mismatch };
    }

    switch (fetched.status) {
      case 'succeeded':
        return yield* capture(row, fetched, now());
      case 'failed': {
        // A declined intent can still be confirmed with another card. Cancel
        // it before releasing the order so nothing can succeed afterwards —
        // and if it succeeded in the meantime, record that instead.
        const after = yield* payments.cancelPayment(row.providerReference);
        return after.status === 'succeeded'
          ? yield* capture(row, after, now())
          : yield* fail(row, fetched.failureReason ?? 'The payment was declined.');
      }
      case 'canceled':
        return yield* fail(row, fetched.failureReason ?? 'The payment was cancelled.');
      default:
        return { outcome: 'pending' as const, payment: row };
    }
  });

export const settlePayment = (paymentId: string, now: () => Date = () => new Date()) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const row = yield* paymentRepo.findById(paymentId);
    const result: SettleResult = yield* settleRow(row, now);
    return result;
  });

/** The webhook's entry point: it knows the provider's reference, not our id.
 * `unknown` for an intent we never created (another integration on the same
 * Stripe account, or a test event). */
export const settlePaymentByReference = (reference: string, now: () => Date = () => new Date()) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const row = yield* paymentRepo.findByProviderReference(payments.provider, reference);
    if (row === null) return { outcome: 'unknown' as const };
    const result: SettleResult = yield* settleRow(row, now);
    return result;
  });
