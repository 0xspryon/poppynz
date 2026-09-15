import type { CheckOrderStatus } from './poppynz-status';

// Credibled's vocabulary translated into Poppynz's.
//
// The load-bearing decision: a PASS does NOT verify anybody. Credibled
// completing a check completes the ORDER, which creates a verdict awaiting a
// human decision. Everything terminal-looking on their side that isn't an
// outright cancellation lands in `complete`.
export const credibledStatusToCheckOrderStatus = (applicationStatus: string): CheckOrderStatus => {
  switch (applicationStatus) {
    case 'Waiting On Candidate':
      return 'invited';
    case 'In Progress':
      return 'in_progress';
    // Complete (pass or fail), Action Required and In Dispute all need a
    // person to look. Failing closed here is deliberate: an unrecognised
    // status must never silently advance somebody toward bookable, and
    // `complete` only ever leads to review.
    case 'Complete':
    case 'Action Required':
    case 'In Dispute':
      return 'complete';
    case 'Cancelled':
      return 'cancelled';
    default:
      return 'complete';
  }
};

/** Statuses that may never be left once reached. */
const terminal: ReadonlyArray<CheckOrderStatus> = ['complete', 'failed', 'cancelled'];

// Rank drives idempotent webhook application: Credibled can deliver events out
// of order, and a late "In Progress" must never drag an order backwards out of
// completion. Only forward moves are applied.
const rank: Record<CheckOrderStatus, number> = {
  draft: 0,
  payment_pending: 1,
  paid: 2,
  invited: 3,
  in_progress: 4,
  complete: 5,
  failed: 5,
  cancelled: 5
};

export const canApplyCredibledTransition = (
  current: CheckOrderStatus,
  next: CheckOrderStatus
): boolean => {
  // A finished order is closed to the vendor. Only Poppynz reopens screening,
  // by creating a new order.
  if (terminal.includes(current)) {
    return false;
  }
  // Credibled only ever reports on an order it holds — one that has been
  // placed. A delivery for a draft or an unplaced order is nonsense and must
  // not advance it past the worker.
  if (rank[current] < rank.invited) {
    return false;
  }
  return rank[next] > rank[current];
};
