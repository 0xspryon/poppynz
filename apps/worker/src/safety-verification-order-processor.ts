import { Credibled } from '@repo/credibled';
import { SafetyVerificationRepo, UserRepo, type SafetyVerification } from '@repo/db';
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

const audienceFor = (record: SafetyVerification) =>
  record.role === 'family' ? ('family' as const) : ('service-provider' as const);

/** Refund and close the record out. Called once attempts are exhausted. */
const refundAndFail = (record: SafetyVerification, reason: string) =>
  Effect.gen(function* () {
    const repo = yield* SafetyVerificationRepo;
    const payments = yield* Payments;

    if (!record.paymentReference) {
      // Nothing was charged, so there is nothing to give back.
      yield* repo.update(record.id, { status: 'rejected', lastOrderError: reason });
      return `verification ${record.id}: failed with no payment to refund`;
    }

    const refund = yield* payments
      .refund({ reference: record.paymentReference, reason })
      .pipe(Effect.option);

    if (refund._tag === 'None') {
      // Leave the record in payment_pending: a failed refund must stay visible
      // and retryable rather than being closed out as if it were settled.
      yield* repo.update(record.id, {
        lastOrderError: `${reason} (refund failed — needs manual settlement)`
      });
      return `verification ${record.id}: REFUND FAILED after ${reason}`;
    }

    yield* repo.update(record.id, {
      status: 'rejected',
      refundReference: refund.value.refundReference,
      decisionReason:
        'We could not place your check with our screening provider, so your payment was refunded.',
      lastOrderError: reason
    });
    return `verification ${record.id}: refunded after ${reason}`;
  });

export const placeSafetyVerificationOrder = (verificationId: string) =>
  Effect.gen(function* () {
    const repo = yield* SafetyVerificationRepo;
    const credibled = yield* Credibled;
    const config = yield* policy;

    const record = yield* repo.findById(verificationId).pipe(Effect.option);
    if (record._tag === 'None') {
      return `verification ${verificationId}: gone, nothing to order`;
    }
    const verification = record.value;

    // Idempotency: the queue dedupes, but a redelivered job or the boot-time
    // recovery sweep can still land here twice.
    if (verification.credibledCheckUuid) {
      return `verification ${verificationId}: already ordered`;
    }
    if (verification.status !== 'payment_pending') {
      return `verification ${verificationId}: status ${verification.status}, not orderable`;
    }
    if (!verification.paymentReference) {
      return `verification ${verificationId}: not paid, refusing to order`;
    }
    // The basket travels with the record. An empty one means the order route
    // let something through it shouldn't have — refund rather than call
    // Credibled with no check types.
    const items = yield* repo.listItems(verification.id);
    if (items.length === 0) {
      return yield* refundAndFail(verification, 'no Credibled checks selected');
    }
    const checkTypeValues = items.map((item) => item.credibledCheckTypeValue);

    const attempts = verification.orderAttempts + 1;
    yield* repo.update(verification.id, { orderAttempts: attempts });

    const userRepo = yield* UserRepo;
    const applicant = yield* userRepo.findById(verification.userId).pipe(Effect.option);
    if (applicant._tag === 'None' || !applicant.value.email) {
      return yield* refundAndFail(verification, 'applicant has no email address');
    }
    const applicantEmail = applicant.value.email;

    const created = yield* credibled
      .createBackgroundCheck({
        audience: audienceFor(verification),
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
          verification,
          `Credibled order failed after ${attempts} attempts`
        );
      }
      yield* repo.update(verification.id, {
        lastOrderError: `attempt ${attempts} failed`
      });
      // Throwing hands the job back to BullMQ's backoff rather than swallowing
      // it — the record must not sit paid-but-unordered without a retry.
      return yield* Effect.fail(
        new Error(`Credibled order attempt ${attempts} failed for ${verification.id}`)
      );
    }

    yield* repo.update(verification.id, {
      status: 'invited',
      credibledCheckUuid: created.value.uuid,
      applicationUrl: created.value.applicationUrl,
      lastOrderError: null
    });

    // Credibled emails the applicant the secure link itself (send_email: true),
    // so Poppynz deliberately sends nothing here — two mails for one action
    // reads as a bug. The link is also surfaced in-app, and the reconcile
    // poller keeps the record moving regardless of what the applicant does.

    return (
      `verification ${verification.id}: ordered ${checkTypeValues.length} check(s) ` +
      `as ${created.value.uuid}`
    );
  });

/** Boot-time recovery for records charged but never ordered — covers a queue
 * job lost between the charge and the order. */
export const recoverUnorderedSafetyVerifications = Effect.gen(function* () {
  const repo = yield* SafetyVerificationRepo;
  const pending = yield* repo.listAwaitingOrder();

  const results = yield* Effect.forEach(
    pending,
    (record) => placeSafetyVerificationOrder(record.id).pipe(Effect.option),
    { concurrency: 3 }
  );

  return { recovered: results.filter((result) => result._tag === 'Some').length };
});
