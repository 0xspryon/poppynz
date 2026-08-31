import { SafetyVerificationRepo, UserRepo, type SafetyVerification } from '@repo/db';
import { safetyVerificationConfig } from '@repo/env';
import { Mailer } from '@repo/mail';
import { Effect } from 'effect';

/**
 * Daily expiry sweep.
 *
 * Two jobs, deliberately in this order:
 *
 *   1. Settle records that have already lapsed, so the stored status matches
 *      what every reader already presents. Reads apply expiry at read time
 *      (see `presentedStatus`), so this sweep is bookkeeping — an outage here
 *      delays the mail, it does NOT leave an expired applicant bookable.
 *   2. Remind the ones about to lapse, once each, guarded by
 *      `expiry_notified_at` exactly as the approval sweep is.
 */

const policy = safetyVerificationConfig.pipe(
  Effect.map((config) => ({
    expiryReminderDays: config.expiryReminderDays
  })),
  Effect.orElseSucceed(() => ({ expiryReminderDays: 30 }))
);

const toDateOnly = (at: Date) => at.toISOString().slice(0, 10);

const addDays = (at: Date, days: number) =>
  new Date(at.getTime() + days * 24 * 60 * 60 * 1000);

const daysUntil = (expiresOn: string, now: Date) =>
  Math.max(
    1,
    Math.ceil((Date.parse(`${expiresOn}T00:00:00Z`) - now.getTime()) / (24 * 60 * 60 * 1000))
  );

const renewalLink = (record: SafetyVerification, uiOrigin: string) =>
  `${uiOrigin}/${record.role === 'family' ? 'family' : 'service-provider'}/verification`;

export const processSafetyVerificationExpiries = (now: Date, uiOrigin: string) =>
  Effect.gen(function* () {
    const repo = yield* SafetyVerificationRepo;
    const userRepo = yield* UserRepo;
    const mailer = yield* Mailer;
    const config = yield* policy;

    const currentDate = toDateOnly(now);

    // --- 1. settle lapsed records -----------------------------------------
    const lapsed = yield* repo.listLapsed(currentDate);
    yield* Effect.forEach(
      lapsed,
      (record) => repo.update(record.id, { status: 'expired' }).pipe(Effect.option),
      { concurrency: 5 }
    );

    // --- 2. remind the ones about to lapse ---------------------------------
    const until = toDateOnly(addDays(now, config.expiryReminderDays));
    const expiring = yield* repo.listExpiringForNotification(currentDate, until);

    const results = yield* Effect.forEach(
      expiring,
      (record) =>
        Effect.gen(function* () {
          const user = yield* userRepo.findById(record.userId).pipe(Effect.option);
          if (user._tag === 'None' || !user.value.email) {
            return 'skipped' as const;
          }

          const sent = yield* mailer
            .sendSafetyVerificationExpiring({
              email: user.value.email,
              name: user.value.name,
              role: record.role === 'family' ? 'family' : 'service-provider',
              expiresOn: record.expiresOn ?? '',
              daysRemaining: daysUntil(record.expiresOn ?? toDateOnly(now), now),
              link: renewalLink(record, uiOrigin)
            })
            .pipe(Effect.option);
          if (sent._tag === 'None') {
            // Leave expiry_notified_at unset so the next sweep retries — a
            // failed send must not silently consume the one reminder.
            return 'failed' as const;
          }

          yield* repo.markExpiryNotified(record.id, now);
          return 'notified' as const;
        }).pipe(Effect.orElseSucceed(() => 'failed' as const)),
      { concurrency: 5 }
    );

    return {
      lapsed: lapsed.length,
      candidates: expiring.length,
      notified: results.filter((result) => result === 'notified').length,
      skipped: results.filter((result) => result === 'skipped').length,
      failed: results.filter((result) => result === 'failed').length
    };
  });
