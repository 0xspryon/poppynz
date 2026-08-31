// Mirrors the `safety_verification_status` enum in @repo/db.
//
// Duplicated rather than imported so @repo/credibled stays a leaf package with
// no database dependency — the API's own build fails if the two ever diverge,
// because the status mapper is consumed where the db type is required.
export const safetyVerificationStatuses = [
  'not_started',
  'payment_pending',
  'invited',
  'in_progress',
  'review_required',
  'verified',
  'rejected',
  'expired'
] as const;

export type SafetyVerificationStatus = (typeof safetyVerificationStatuses)[number];
