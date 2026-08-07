import {
  ApprovalRepo,
  type ApprovalExpiryCandidate,
  type ApprovalExpiryNotifiedStamps
} from '@repo/db';
import { Mailer } from '@repo/mail';
import { Effect } from 'effect';

const dayMs = 24 * 60 * 60 * 1000;

/** Warning tiers, shortest horizon first so the first match is the deepest
 * (most urgent) tier that applies. "One month" is 30 days. */
export const approvalExpiryTiers = [
  { key: 'twoDays', withinMs: 2 * dayMs, column: 'notifiedExpiresInTwoDaysAt' },
  { key: 'oneWeek', withinMs: 7 * dayMs, column: 'notifiedExpiresInOneWeekAt' },
  { key: 'twoWeeks', withinMs: 14 * dayMs, column: 'notifiedExpiresInTwoWeeksAt' },
  { key: 'oneMonth', withinMs: 30 * dayMs, column: 'notifiedExpiresInOneMonthAt' }
] as const;

export const approvalExpiryWindowMs = 30 * dayMs;

const notifyCandidate = (candidate: ApprovalExpiryCandidate, now: Date, uiOrigin: string) =>
  Effect.gen(function* () {
    const remainingMs = candidate.expiresAt.getTime() - now.getTime();
    const tierIndex = approvalExpiryTiers.findIndex((tier) => remainingMs <= tier.withinMs);
    if (tierIndex === -1) return 'skipped' as const;

    const tier = approvalExpiryTiers[tierIndex]!;
    if (candidate[tier.column] !== null) return 'skipped' as const;

    const mailer = yield* Mailer;
    const repo = yield* ApprovalRepo;

    yield* mailer.sendApprovalExpiring({
      email: candidate.applicant.email,
      name: candidate.applicant.name || null,
      expiresAt: candidate.expiresAt,
      daysRemaining: Math.max(1, Math.ceil(remainingMs / dayMs)),
      link: uiOrigin
    });

    // Stamp the fired tier AND every longer tier that never fired: an
    // approval that entered the window late gets exactly this one mail, and
    // the milder warnings are never back-filled. Stamped only after a
    // successful send so a failed delivery retries on the next run.
    const stamps: ApprovalExpiryNotifiedStamps = {};
    for (const laterTier of approvalExpiryTiers.slice(tierIndex)) {
      if (candidate[laterTier.column] === null) {
        stamps[laterTier.column] = now;
      }
    }
    yield* repo.markExpiryNotified(candidate.id, stamps);

    return 'notified' as const;
  });

/** Daily sweep: warn providers whose current approval expires within 30 days.
 * Idempotent — each tier fires at most once per approval (persisted stamps),
 * so re-runs and retries send nothing extra. Per-candidate failures are
 * logged and skipped; the batch always completes. */
export const processApprovalExpiryNotifications = (now: Date, uiOrigin: string) =>
  Effect.gen(function* () {
    const repo = yield* ApprovalRepo;
    const candidates = yield* repo.listExpiringForNotification(
      now,
      new Date(now.getTime() + approvalExpiryWindowMs)
    );

    let notified = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      const outcome = yield* notifyCandidate(candidate, now, uiOrigin).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `approval expiry notification failed for approval ${candidate.id}`,
            error
          ).pipe(Effect.as('failed' as const))
        )
      );
      if (outcome === 'notified') notified += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    return { candidates: candidates.length, notified, skipped, failed };
  });
