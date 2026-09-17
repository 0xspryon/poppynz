import { ApprovalRepo } from '@repo/db';
import { Data, Effect } from 'effect';
import type { UserAndSession } from './effect-auth';

/**
 * The approval gate: a live admin approval is what lets an applicant use the
 * marketplace RIGHT NOW — be listed, search the other side, and reach out.
 *
 * One shared helper for both roles, in the same spirit as
 * `requireVerifiedSafety`: the first version of this check lived inline in
 * each route and only ran where `role === 'service-provider'`, which is how
 * families were never gated on approval at all. Admins are never applicants
 * and are never blocked here.
 */

export type ApplicantRole = 'family' | 'service-provider';

/** Narrows a stored account role to the two that go through approval. */
export const applicantRoleOf = (role: string | null | undefined): ApplicantRole | null =>
  role === 'family' || role === 'service-provider' ? role : null;

export class ApprovalRequiredError extends Data.TaggedError('ApprovalRequiredError')<{
  role: ApplicantRole;
}> {}

/** The gate could not be evaluated. Fails CLOSED, like the safety gate: an
 * unprovable approval must deny rather than admit. */
export class ApprovalGateUnavailableError extends Data.TaggedError(
  'ApprovalGateUnavailableError'
)<{}> {}

export const requireLiveApproval = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const role = applicantRoleOf(userAndSession.user.role);
    if (role === null) {
      return;
    }

    const repo = yield* ApprovalRepo;
    // findCurrentByUserId only returns a live `approved` row, so "not found"
    // covers never approved, revoked and expired alike.
    yield* repo.findCurrentByUserId(userAndSession.user.id).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new ApprovalRequiredError({ role })),
        SqlError: () => Effect.fail(new ApprovalGateUnavailableError())
      })
    );
  });

type ApprovalRequiredResponseBody =
  | { code: 'FAMILY_NOT_APPROVED'; message: string }
  | { code: 'PROVIDER_NOT_APPROVED'; message: string };

/** The two codes stay distinct so each web app can route the applicant to
 * its own approval page; the message names what the approval unlocks. */
export const approvalRequiredResponseBody = (
  role: ApplicantRole,
  message?: string
): ApprovalRequiredResponseBody =>
  role === 'family'
    ? {
        code: 'FAMILY_NOT_APPROVED' as const,
        message:
          message ?? 'Finding and contacting helpers is available once your profile is approved.'
      }
    : {
        code: 'PROVIDER_NOT_APPROVED' as const,
        message: message ?? 'Family search is available once your profile is approved.'
      };

export const approvalGateUnavailableResponseBody = {
  code: 'APPROVAL_UNAVAILABLE' as const,
  message: 'We could not confirm your approval. Please try again shortly.'
};
