import type { SafeUserProfile } from '@repo/db';
import type { ApplicantRole } from './approval-gate';
import type { DocumentChecklistEntry } from './onboarding-checklist';

/**
 * What stands between an applicant and approval (UAT #25, #27, #30).
 *
 * The approve action is refused server-side while any blocker remains; the
 * admin review page lists the same blockers so it can say exactly what is
 * missing, and the queue flags the request instead of approving it.
 *
 * Every REQUIRED document must have been reviewed and approved on its own —
 * an uploaded file no longer satisfies the requirement by existing — and a
 * helper needs the profile photo their profile is marked as requiring.
 */
export type ApprovalBlocker =
  | { kind: 'document_missing'; documentTypeId: string; name: string }
  | { kind: 'document_rejected'; documentTypeId: string; name: string }
  | { kind: 'document_expired'; documentTypeId: string; name: string }
  | { kind: 'document_unreviewed'; documentTypeId: string; name: string }
  | { kind: 'photo_missing' };

export const approvalBlockers = (input: {
  role: ApplicantRole;
  profile: Pick<SafeUserProfile, 'image'>;
  checklist: ReadonlyArray<
    Pick<DocumentChecklistEntry, 'documentTypeId' | 'name' | 'isOptional' | 'status'>
  >;
}): Array<ApprovalBlocker> => {
  const blockers: Array<ApprovalBlocker> = [];
  if (input.role === 'service-provider' && !input.profile.image) {
    blockers.push({ kind: 'photo_missing' });
  }
  for (const entry of input.checklist) {
    if (entry.isOptional) continue;
    const ref = { documentTypeId: entry.documentTypeId, name: entry.name };
    switch (entry.status) {
      case 'approved':
        break;
      case 'missing':
        blockers.push({ kind: 'document_missing', ...ref });
        break;
      case 'rejected':
        blockers.push({ kind: 'document_rejected', ...ref });
        break;
      case 'expired':
        blockers.push({ kind: 'document_expired', ...ref });
        break;
      case 'submitted':
        blockers.push({ kind: 'document_unreviewed', ...ref });
        break;
    }
  }
  return blockers;
};

/**
 * What blocks SUBMITTING for review (UAT #12). The conservative reading of
 * the rule: an applicant can't send a request that is bound to be refused for
 * something only they can fix — a required document they haven't provided
 * (or that was rejected), or a helper's required photo. Documents awaiting
 * the admin's own review don't block submitting; reviewing them is the
 * admin's job.
 */
export const submissionBlockers = (
  input: Parameters<typeof approvalBlockers>[0]
): Array<ApprovalBlocker> =>
  approvalBlockers(input).filter((blocker) => blocker.kind !== 'document_unreviewed');

/**
 * A check the applicant has already paid Credibled for (paid, invited or in
 * progress) is evidence on its way: its verdict lands with the admin anyway,
 * so a request is not refused for the documents that check will produce
 * (R11 — a family with a paid, in-progress check was told its safety check
 * "has not been submitted"). Only `document_missing` is waived; a rejected
 * or expired document still needs the applicant.
 */
export const paidCheckStatuses = ['paid', 'invited', 'in_progress'] as const;

export const waiveBlockersForChecksInProgress = (
  blockers: ReadonlyArray<ApprovalBlocker>,
  documentTypeIdsInProgress: ReadonlySet<string>
): Array<ApprovalBlocker> =>
  blockers.filter(
    (blocker) =>
      !(
        blocker.kind === 'document_missing' &&
        documentTypeIdsInProgress.has(blocker.documentTypeId)
      )
  );

/** One line per blocker, for error messages and the admin UI. */
export const describeBlocker = (blocker: ApprovalBlocker): string => {
  switch (blocker.kind) {
    case 'photo_missing':
      return 'Profile photo is missing';
    case 'document_missing':
      return `${blocker.name} has not been submitted`;
    case 'document_rejected':
      return `${blocker.name} was rejected and needs a new upload`;
    case 'document_expired':
      return `${blocker.name} has expired and needs a new upload`;
    case 'document_unreviewed':
      return `${blocker.name} has not been reviewed yet — approve or reject it first`;
  }
};
