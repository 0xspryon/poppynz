import type { SafetyVerification, SafetyVerificationRole } from '@repo/db';
import type { SafetyVerificationStatus } from '@repo/credibled';

// Pure safety-verification domain logic: what a record presents as, when it
// lapses, and what each audience is allowed to see. Kept free of Effect and of
// repositories so every rule here is directly unit-testable.

/**
 * Dates are stored as `date` columns and compared in UTC.
 *
 * UTC is ahead of every Canadian timezone, so a UTC "today" rolls over before
 * any local one — a verification therefore lapses slightly EARLY rather than
 * slightly late. For a safety gate that is the correct direction to be wrong
 * in, and it avoids inventing a single business timezone for a country that
 * spans six of them.
 */
export const toDateOnly = (at: Date): string => at.toISOString().slice(0, 10);

export const addMonths = (at: Date, months: number): Date => {
  const result = new Date(at.getTime());
  const targetMonth = result.getUTCMonth() + months;
  result.setUTCMonth(targetMonth);
  // Clamp Jan 31 + 1 month to Feb 28/29 rather than letting it roll into March.
  if (result.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setUTCDate(0);
  }
  return result;
};

/** Credibled reports completion but never an expiry, so Path A's validity
 * window comes from policy. */
export const expiryFromCompletion = (completedAt: Date, validityMonths: number): string =>
  toDateOnly(addMonths(completedAt, validityMonths));

/**
 * Read-time expiry, mirroring how contracts present `ended`.
 *
 * A verified record past its expiry date presents as expired the moment it is
 * read, without waiting for the nightly sweep. That closes the window in which
 * a lapsed applicant would still pass the gate because cron hadn't run yet —
 * the sweep exists to send mail and settle the stored status, never to be the
 * thing that enforces expiry.
 */
export const presentedStatus = (
  record: Pick<SafetyVerification, 'status' | 'expiresOn'>,
  today: string
): SafetyVerificationStatus => {
  if (record.status === 'verified') {
    // A verification with no expiry date is treated as expired rather than as
    // valid forever. The approval path always sets one, so this only fires on
    // a corrupted or hand-edited row — and an unbounded verification is
    // exactly the failure a safety gate must not have.
    if (!record.expiresOn || record.expiresOn < today) {
      return 'expired';
    }
  }
  return record.status;
};

/** The single gate the rest of the app asks about. */
export const isVerified = (
  record: Pick<SafetyVerification, 'status' | 'expiresOn'> | null,
  today: string
): boolean => record !== null && presentedStatus(record, today) === 'verified';

export const isTerminalStatus = (status: SafetyVerificationStatus): boolean =>
  status === 'verified' || status === 'rejected' || status === 'expired';

/**
 * What the applicant sees about their own verification.
 *
 * Deliberately omits every field that could carry screening detail — no
 * report contents, no per-check scores, no reviewer identity. `decisionReason`
 * is included because an applicant is entitled to know why they were rejected,
 * and it is admin-authored prose rather than vendor data.
 */
export const toApplicantSummary = (record: SafetyVerification | null, today: string) => {
  if (!record) {
    return {
      status: 'not_started' as SafetyVerificationStatus,
      route: null,
      consentAt: null,
      issuedOn: null,
      expiresOn: null,
      decisionReason: null,
      // Never a real link when there is no record.
      applicationUrl: null,
      cost: null
    };
  }

  return {
    status: presentedStatus(record, today),
    route: record.route,
    consentAt: record.consentAt?.toISOString() ?? null,
    issuedOn: record.issuedOn,
    expiresOn: record.expiresOn,
    decisionReason: record.decisionReason,
    // Only while the applicant still has something to do with it.
    applicationUrl:
      record.status === 'invited' || record.status === 'in_progress'
        ? record.applicationUrl
        : null,
    cost:
      record.totalCents === null
        ? null
        : {
            amountCents: record.amountCents ?? 0,
            feeCents: record.feeCents ?? 0,
            taxCents: record.taxCents ?? 0,
            totalCents: record.totalCents,
            currency: 'CAD' as const
          }
  };
};

/**
 * What a reviewing administrator sees.
 *
 * Still not the report itself — that is fetched on demand from Credibled by a
 * separate authorised call and never cached into our storage. What's here is
 * the metadata needed to make a decision.
 */
export const toAdminSummary = (record: SafetyVerification, today: string) => ({
  id: record.id,
  userId: record.userId,
  role: record.role,
  status: presentedStatus(record, today),
  storedStatus: record.status,
  route: record.route,
  hasCredibledCheck: record.credibledCheckUuid !== null,
  consentAt: record.consentAt?.toISOString() ?? null,
  consentPolicyVersion: record.consentPolicyVersion,
  issuingAuthority: record.issuingAuthority,
  documentNumber: record.documentNumber,
  filename: record.filename,
  issuedOn: record.issuedOn,
  expiresOn: record.expiresOn,
  reviewedBy: record.reviewedBy,
  reviewedAt: record.reviewedAt?.toISOString() ?? null,
  decisionReason: record.decisionReason,
  paymentReference: record.paymentReference,
  refundReference: record.refundReference,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString()
});

/**
 * The badge other users are allowed to see about somebody.
 *
 * A boolean and a date. Never the route, never a reason, never a document
 * number — a family looking at a helper learns that Poppynz verified them and
 * when it lapses, and nothing else.
 */
export const toPublicBadge = (
  record: Pick<SafetyVerification, 'status' | 'expiresOn'> | null,
  today: string
) => ({
  verified: isVerified(record, today),
  verifiedUntil: isVerified(record, today) ? (record?.expiresOn ?? null) : null
});

export const credibledAudienceForRole = (role: SafetyVerificationRole) =>
  role === 'family' ? ('family' as const) : ('service-provider' as const);
