import { SafetyVerificationRepo } from '@repo/db';
import { Data, Effect } from 'effect';
import type { UserAndSession } from './effect-auth';
import { isVerified, toDateOnly } from './safety-verification';

/**
 * The one gate: nobody becomes bookable without an approved safety
 * verification.
 *
 * Deliberately a single shared helper rather than a check copied into each
 * route. The previous approval gate was applied only where `role ===
 * 'service-provider'`, which is exactly how families ended up ungated — one
 * function with one rule makes that failure mode harder to reintroduce.
 *
 * Applies to families and helpers alike. Admins are never screened and are
 * never blocked by this.
 */

export class SafetyVerificationRequiredError extends Data.TaggedError(
  'SafetyVerificationRequiredError'
)<{ role: 'family' | 'service-provider' }> {}

/** The gate could not be evaluated. Kept distinct from "not verified" so the
 * applicant isn't told they failed a check that never ran — but it still
 * BLOCKS. A database error must never open a safety gate. */
export class SafetyVerificationGateUnavailableError extends Data.TaggedError(
  'SafetyVerificationGateUnavailableError'
)<{}> {}

export const requireVerifiedSafety = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const role = userAndSession.user.role;
    if (role !== 'family' && role !== 'service-provider') {
      // Admins and unroled accounts aren't applicants.
      return;
    }

    const repo = yield* SafetyVerificationRepo;
    // Fail CLOSED. If the lookup fails we cannot prove the applicant is
    // verified, and an unprovable gate must deny rather than admit.
    const record = yield* repo
      .findLive(userAndSession.user.id, role)
      .pipe(
        Effect.catchTag('SqlError', () => Effect.fail(new SafetyVerificationGateUnavailableError()))
      );

    // `isVerified` applies expiry at read time, so a lapsed record fails the
    // gate the moment its date passes — without waiting for the nightly sweep.
    if (!isVerified(record, toDateOnly(new Date()))) {
      return yield* Effect.fail(new SafetyVerificationRequiredError({ role }));
    }
  });

export const safetyVerificationRequiredResponseBody = {
  code: 'SAFETY_VERIFICATION_REQUIRED' as const,
  message: 'Complete your Poppynz safety verification to use this feature.'
};

export const safetyVerificationGateUnavailableResponseBody = {
  code: 'SAFETY_VERIFICATION_UNAVAILABLE' as const,
  message: 'We could not confirm your safety verification. Please try again shortly.'
};
