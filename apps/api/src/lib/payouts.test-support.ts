import type { PayoutAccountSnapshot } from '@repo/payments';

/** Test-only: a provider snapshot of a fully enabled account. The stored-row
 * fixtures (`dummyPayoutAccount`, `makeInMemoryPayoutAccountRepo`) live in
 * `@repo/db`, next to the repo. */
export const readySnapshot = (
  overrides: Partial<PayoutAccountSnapshot> = {}
): PayoutAccountSnapshot => ({
  detailsSubmitted: true,
  payoutsEnabled: true,
  transfersActive: true,
  requirementsDue: [],
  disabledReason: null,
  ...overrides
});
