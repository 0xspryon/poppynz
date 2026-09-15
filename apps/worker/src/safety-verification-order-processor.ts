import { Credibled } from '@repo/credibled';
import {
  CheckOrderRepo,
  isSettledPayment,
  PaymentRepo,
  UserRepo,
  type CheckOrder,
  type Payment
} from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import { Payments } from '@repo/payments';
import { Effect } from 'effect';

/**
 * Places a paid-for order with Credibled.
 *
 * Runs in the worker rather than inline in the request so a Credibled outage
 * is a retry instead of a lost payment. The invariant this file protects:
 * money has already changed hands by the time we get here, so every path ends
 * either with an order placed or with the charge refunded — never with a
 * silent drop.
 */

const policy = safetyVerificationConfig.pipe(
  Effect.orElseSucceed(() => ({
    validityMonths: 12,
    expiryReminderDays: 30,
    consentPolicyVersion: '2026-08-22',
    checkCostCents: 5500,
    adminFeeCents: 500,
    taxRateBasisPoints: 0,
    orderMaxAttempts: 3
  }))
);

const audienceFor = (order: CheckOrder) =>
  order.role === 'family' ? ('family' as const) : ('service-provider' as const);

/** Refund and close the order out. Called once attempts are exhausted. */
const refundAndFail = (order: CheckOrder, payment: Payment | null, reason: string) =>
  Effect.gen(function* () {
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;

    if (payment === null || !isSettledPayment(payment) || !payment.providerReference) {
      // Nothing was charged, so there is nothing to give back.
      yield* orders.update(order.id, { status: 'failed', lastOrderError: reason });
      return `order ${order.id}: failed with no payment to refund`;
    }

    // Keyed on the payment row: a refund that succeeded at the provider but
    // whose record here was lost is retried under the same key, not repeated.
    const refund = yield* payments
      .refund({ reference: payment.providerReference, reason, idempotencyKey: payment.id })
      .pipe(Effect.option);

    if (refund._tag === 'None') {
      // Leave the order `paid`: a failed refund must stay visible and
      // retryable rather than being closed out as if it were settled. The
      // note lives on the payment — that is the row holding the money.
      yield* paymentRepo.update(payment.id, {
        lastError: `${reason} (refund failed — needs manual settlement)`
      });
      yield* orders.update(order.id, { lastOrderError: reason });
      return `order ${order.id}: REFUND FAILED after ${reason}`;
    }

    yield* paymentRepo.update(payment.id, {
      status: 'refunded',
      refundReference: refund.value.refundReference,
      refundedAt: refund.value.refundedAt,
      lastError: null
    });
    yield* orders.update(order.id, { status: 'failed', lastOrderError: reason });
    return `order ${order.id}: refunded after ${reason}`;
  });

export const placeCheckOrder = (orderId: string) =>
  Effect.gen(function* () {
    const orders = yield* CheckOrderRepo;
    const paymentRepo = yield* PaymentRepo;
    const credibled = yield* Credibled;
    const config = yield* policy;

    const found = yield* orders.findById(orderId).pipe(Effect.option);
    if (found._tag === 'None') {
      return `order ${orderId}: gone, nothing to order`;
    }
    const order = found.value;

    // Idempotency: the queue dedupes, but a redelivered job or the boot-time
    // recovery sweep can still land here twice.
    if (order.credibledCheckUuid) {
      return `order ${orderId}: already ordered`;
    }
    if (order.status !== 'paid') {
      return `order ${orderId}: status ${order.status}, not orderable`;
    }

    // `paid` says the charge settled; the payment row is the proof. Refusing
    // here rather than refunding is deliberate: a `paid` order with no settled
    // payment is an inconsistency to look at, not a case to auto-close.
    const payment = order.paymentId
      ? yield* paymentRepo.findById(order.paymentId).pipe(Effect.option)
      : ({ _tag: 'None' } as const);
    if (payment._tag === 'None' || !isSettledPayment(payment.value)) {
      return `order ${orderId}: not paid, refusing to order`;
    }

    // The basket travels with the order. An empty one means the order route
    // let something through it shouldn't have — refund rather than call
    // Credibled with no check types.
    const items = yield* orders.listItems(order.id);
    if (items.length === 0) {
      return yield* refundAndFail(order, payment.value, 'no Credibled checks selected');
    }
    const checkTypeValues = items.map((item) => item.credibledCheckTypeValue);

    const attempts = order.orderAttempts + 1;
    yield* orders.update(order.id, { orderAttempts: attempts });

    const userRepo = yield* UserRepo;
    const applicant = yield* userRepo.findById(order.userId).pipe(Effect.option);
    if (applicant._tag === 'None' || !applicant.value.email) {
      return yield* refundAndFail(order, payment.value, 'applicant has no email address');
    }
    const applicantEmail = applicant.value.email;

    const created = yield* credibled
      .createBackgroundCheck({
        audience: audienceFor(order),
        email: applicantEmail,
        checkTypeValues: checkTypeValues as never
      })
      .pipe(
        // A duplicate is a success: Credibled already holds an equivalent open
        // check for this applicant, so we adopt it rather than paying twice.
        Effect.catchTag('CredibledDuplicateCheckError', (error) =>
          error.existingUuid
            ? Effect.succeed({
                uuid: error.existingUuid,
                email: applicantEmail,
                applicationStatus: 'Waiting On Candidate',
                applicationUrl: null
              })
            : Effect.fail(error)
        ),
        Effect.option
      );

    if (created._tag === 'None') {
      if (attempts >= config.orderMaxAttempts) {
        return yield* refundAndFail(
          order,
          payment.value,
          `Credibled order failed after ${attempts} attempts`
        );
      }
      yield* orders.update(order.id, {
        lastOrderError: `attempt ${attempts} failed`
      });
      // Throwing hands the job back to BullMQ's backoff rather than swallowing
      // it — the order must not sit paid-but-unplaced without a retry.
      return yield* Effect.fail(
        new Error(`Credibled order attempt ${attempts} failed for ${order.id}`)
      );
    }

    yield* orders.update(order.id, {
      status: 'invited',
      credibledCheckUuid: created.value.uuid,
      applicationUrl: created.value.applicationUrl,
      lastOrderError: null
    });

    // Credibled emails the applicant the secure link itself (send_email: true),
    // so Poppynz deliberately sends nothing here — two mails for one action
    // reads as a bug. The link is also surfaced in-app, and the reconcile
    // poller keeps the order moving regardless of what the applicant does.

    return (
      `order ${order.id}: placed ${checkTypeValues.length} check(s) ` +
      `as ${created.value.uuid}`
    );
  });

/** Boot-time recovery for orders charged but never placed — covers a queue
 * job lost between the charge and the order. */
export const recoverUnplacedCheckOrders = Effect.gen(function* () {
  const orders = yield* CheckOrderRepo;
  const pending = yield* orders.listAwaitingPlacement();

  const results = yield* Effect.forEach(
    pending,
    (order) => placeCheckOrder(order.id).pipe(Effect.option),
    { concurrency: 3 }
  );

  return { recovered: results.filter((result) => result._tag === 'Some').length };
});
