// Mirrors the `check_order_status` enum in @repo/db.
//
// Duplicated rather than imported so @repo/credibled stays a leaf package with
// no database dependency — the API's own build fails if the two ever diverge,
// because the status mapper is consumed where the db type is required.
//
// Credibled's vocabulary maps onto an ORDER's progress, never onto the safety
// verdict: a vendor event can move an order to `complete`, and completing an
// order is what creates a verdict in review_required.
export const checkOrderStatuses = [
  'draft',
  'payment_pending',
  'paid',
  'invited',
  'in_progress',
  'complete',
  'failed',
  'cancelled'
] as const;

export type CheckOrderStatus = (typeof checkOrderStatuses)[number];
