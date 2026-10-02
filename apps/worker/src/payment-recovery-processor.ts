import { settlePayment } from '@repo/billing';
import { PaymentRepo } from '@repo/db';
import { stripeConfig } from '@repo/env';
import { Payments } from '@repo/payments';
import { Effect } from 'effect';

/**
 * Payment recovery, every 15 minutes.
 *
 * The browser's confirm request and the Stripe webhook normally settle a
 * payment within seconds. This job is the backstop for when neither arrives
 * (tab closed mid-3-D Secure, webhook lost): a payment still `pending` after
 * PAYMENTS_SETTLE_AFTER_MINUTES is settled from the provider's state, and one
 * still unfinished after PAYMENTS_ABANDON_AFTER_HOURS is cancelled first —
 * settle then marks it failed and returns its order to the basket.
 */

const windows = stripeConfig.pipe(
  Effect.map((config) => ({
    settleAfterMinutes: config.settleAfterMinutes,
    abandonAfterHours: config.abandonAfterHours
  })),
  Effect.orElseSucceed(() => ({ settleAfterMinutes: 10, abandonAfterHours: 24 }))
);

export type PaymentRecoverySummary = {
  checked: number;
  captured: number;
  failed: number;
  abandoned: number;
  errors: number;
};

export const recoverPendingPayments = (now: Date) =>
  Effect.gen(function* () {
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;
    const { settleAfterMinutes, abandonAfterHours } = yield* windows;

    const stale = yield* paymentRepo.listStalePending(
      payments.provider,
      new Date(now.getTime() - settleAfterMinutes * 60_000)
    );
    const abandonBefore = now.getTime() - abandonAfterHours * 3_600_000;

    const outcomes = yield* Effect.forEach(
      stale,
      (payment) =>
        Effect.gen(function* () {
          const abandoned =
            payment.providerReference !== null && payment.createdAt.getTime() < abandonBefore;
          if (abandoned) {
            // Cancelling first means nothing can succeed after the order is
            // released. An intent that had in fact succeeded comes back as
            // such and is captured below.
            yield* payments.cancelPayment(payment.providerReference!);
          }
          const result = yield* settlePayment(payment.id, () => now);
          return { abandoned, outcome: result.outcome };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logWarning(`payment recovery: ${payment.id} failed`, error).pipe(
              Effect.as({ abandoned: false, outcome: 'error' as const })
            )
          )
        ),
      { concurrency: 3 }
    );

    return {
      checked: outcomes.length,
      captured: outcomes.filter((entry) => entry.outcome === 'captured').length,
      failed: outcomes.filter((entry) => entry.outcome === 'failed').length,
      abandoned: outcomes.filter((entry) => entry.abandoned).length,
      errors: outcomes.filter((entry) => entry.outcome === 'error').length
    } satisfies PaymentRecoverySummary;
  });
