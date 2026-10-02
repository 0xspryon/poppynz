export const validRoles = ['service-provider', 'family'] as const;
export const validApprovalRequestStatuses = ['submitted', 'approved', 'rejected'] as const;
export const validKycDocumentStatuses = ['submitted', 'approved', 'rejected'] as const;
export const validLanguages = ['en', 'es'] as const;
export const signupIntentTtlMs = 5 * 60 * 1000;
export const referralInviteTtlMs = 14 * 24 * 60 * 60 * 1000;

/** Vouches a helper applicant is encouraged (not required) to collect. */
export const RECOMMENDED_VOUCHES = 2;
export const vouchRequestTtlMs = 14 * 24 * 60 * 60 * 1000;

/** POST /vouches rate limit, per applicant: open (pending, unexpired)
 * requests at once, and requests created in a rolling window. */
export const VOUCH_MAX_OPEN_REQUESTS = 5;
export const VOUCH_MAX_REQUESTS_PER_WINDOW = 10;
export const vouchRequestWindowMs = 24 * 60 * 60 * 1000;
