import type { SafetyVerificationStatus } from './poppynz-status';

// Credibled's vocabulary translated into Poppynz's.
//
// The load-bearing decision: a PASS does NOT verify anybody. Credibled
// completing a check makes a record eligible for approval; a human still
// decides. Everything terminal-looking on their side that isn't an outright
// cancellation lands in `review_required`.
export const credibledStatusToSafetyVerificationStatus = (
  applicationStatus: string
): SafetyVerificationStatus => {
  switch (applicationStatus) {
    case 'Waiting On Candidate':
      return 'invited';
    case 'In Progress':
      return 'in_progress';
    // Complete (pass or fail), Action Required and In Dispute all need a
    // person to look. Failing closed here is deliberate: an unrecognised
    // status must never silently advance somebody toward bookable.
    case 'Complete':
    case 'Action Required':
    case 'In Dispute':
      return 'review_required';
    case 'Cancelled':
      return 'rejected';
    default:
      return 'review_required';
  }
};

/** Statuses that may never be left once reached. */
const terminal: ReadonlyArray<SafetyVerificationStatus> = ['verified', 'rejected', 'expired'];

// Rank drives idempotent webhook application: Credibled can deliver events out
// of order, and a late "In Progress" must never drag a record backwards out of
// review. Only forward moves are applied.
const rank: Record<SafetyVerificationStatus, number> = {
  not_started: 0,
  payment_pending: 1,
  invited: 2,
  in_progress: 3,
  review_required: 4,
  verified: 5,
  rejected: 5,
  expired: 5
};

export const canApplyCredibledTransition = (
  current: SafetyVerificationStatus,
  next: SafetyVerificationStatus
): boolean => {
  // A decided record is closed to the vendor. Only Poppynz reopens one, by
  // creating a new record.
  if (terminal.includes(current)) {
    return false;
  }
  return rank[next] > rank[current];
};
