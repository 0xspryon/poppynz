import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { makeMockPayments } from './mock';
import { PaymentProviderError } from './port';

describe('mock payout accounts', () => {
  const payments = makeMockPayments({ now: () => new Date('2026-10-02T12:00:00Z') });

  it('creates one account per user (same reference on a retry)', async () => {
    const first = await Effect.runPromise(
      payments.createPayoutAccount({ userId: 'helper-1', email: 'h@example.com' })
    );
    const again = await Effect.runPromise(
      payments.createPayoutAccount({ userId: 'helper-1', email: 'h@example.com' })
    );
    expect(first.reference).toBe('mock_acct_helper-1');
    expect(again).toEqual(first);
  });

  it('sends onboarding straight back to the return page', async () => {
    const link = await Effect.runPromise(
      payments.createOnboardingLink({
        reference: 'mock_acct_helper-1',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      })
    );
    expect(link.url).toBe('http://localhost:5175/service-provider/payouts?from=stripe');
    expect(link.expiresAt.toISOString()).toBe('2026-10-02T12:05:00.000Z');
  });

  it('reports every account as fully enabled straight away', async () => {
    const snapshot = await Effect.runPromise(payments.getPayoutAccount('mock_acct_helper-1'));
    expect(snapshot).toEqual({
      detailsSubmitted: true,
      payoutsEnabled: true,
      transfersActive: true,
      requirementsDue: [],
      disabledReason: null
    });
  });

  it('returns a harmless dashboard URL', async () => {
    const link = await Effect.runPromise(payments.createDashboardLink('mock_acct_helper-1'));
    expect(link.url).toBe('about:blank');
  });

  it('names payout operations on provider errors', () => {
    const error = new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'x' });
    expect(error.operation).toBe('getPayoutAccount');
  });
});
