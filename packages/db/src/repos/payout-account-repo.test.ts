import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  PayoutAccountRepo
} from './payout-account-repo';

const snapshot = () => ({
  status: 'ready' as const,
  detailsSubmitted: true,
  payoutsEnabled: true,
  transfersActive: true,
  requirementsDue: [],
  disabledReason: null,
  refreshedAt: new Date('2026-10-02T00:00:00.000Z')
});

describe('makeInMemoryPayoutAccountRepo applySnapshot', () => {
  it('applies a snapshot fetched for the account currently on file', async () => {
    const { layer, rows } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ userId: 'helper-1', accountReference: 'acct_A' })
    ]);
    const repo = Effect.runSync(PayoutAccountRepo.pipe(Effect.provide(layer)));
    const result = await Effect.runPromise(repo.applySnapshot('helper-1', 'acct_A', snapshot()));
    expect(result).toMatchObject({ status: 'ready', accountReference: 'acct_A' });
    expect(rows.get('helper-1')).toMatchObject({ status: 'ready' });
  });

  it('is a no-op when the snapshot was fetched for an account that is no longer on file', async () => {
    // Refresh re-fetched account A; a concurrent create() already replaced
    // the row with account B (a provider switch). The in-flight snapshot for
    // A must not land on B's row.
    const { layer, rows } = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ userId: 'helper-1', accountReference: 'acct_B', provider: 'stripe' })
    ]);
    const repo = Effect.runSync(PayoutAccountRepo.pipe(Effect.provide(layer)));
    const result = await Effect.runPromise(repo.applySnapshot('helper-1', 'acct_A', snapshot()));
    expect(result).toBeNull();
    expect(rows.get('helper-1')).toMatchObject({
      accountReference: 'acct_B',
      status: 'onboarding'
    });
  });

  it('is a no-op when the user has no account row at all', async () => {
    const { layer, rows } = makeInMemoryPayoutAccountRepo([]);
    const repo = Effect.runSync(PayoutAccountRepo.pipe(Effect.provide(layer)));
    const result = await Effect.runPromise(repo.applySnapshot('helper-1', 'acct_A', snapshot()));
    expect(result).toBeNull();
    expect(rows.has('helper-1')).toBe(false);
  });
});
