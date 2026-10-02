import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';
import type Stripe from 'stripe';
import {
  makeStripeConnectOperations,
  toPayoutAccountSnapshot,
  type StripeConnectClient
} from './stripe-connect';

const account = (overrides: Record<string, unknown> = {}): Stripe.Account =>
  ({
    id: 'acct_123',
    object: 'account',
    type: 'express',
    charges_enabled: false,
    details_submitted: false,
    payouts_enabled: false,
    email: 'helper@example.com',
    capabilities: { transfers: 'inactive' },
    requirements: {
      currently_due: ['external_account', 'individual.dob.day'],
      past_due: ['individual.dob.day', 'tos_acceptance.date'],
      disabled_reason: 'requirements.past_due'
    },
    ...overrides
  }) as unknown as Stripe.Account;

type Call = { method: string; args: Array<unknown> };

const makeFakeStripe = (options: { retrieved?: Stripe.Account; failWith?: Error } = {}) => {
  const calls: Array<Call> = [];
  const respond = <T>(method: string, args: Array<unknown>, value: T) => {
    calls.push({ method, args });
    return options.failWith ? Promise.reject(options.failWith) : Promise.resolve(value);
  };
  const client = {
    accounts: {
      create: (...args: Array<unknown>) => respond('accounts.create', args, account()),
      retrieve: (...args: Array<unknown>) =>
        respond('accounts.retrieve', args, options.retrieved ?? account()),
      createLoginLink: (...args: Array<unknown>) =>
        respond('accounts.createLoginLink', args, {
          object: 'login_link',
          created: 1790000000,
          url: 'https://connect.stripe.com/express/acct_123/login'
        })
    },
    accountLinks: {
      create: (...args: Array<unknown>) =>
        respond('accountLinks.create', args, {
          object: 'account_link',
          created: 1790000000,
          expires_at: 1790000300,
          url: 'https://connect.stripe.com/setup/e/acct_123/abc'
        })
    }
  } as unknown as StripeConnectClient;
  return { client, calls };
};

describe('toPayoutAccountSnapshot', () => {
  it('normalises a fully enabled account', () => {
    expect(
      toPayoutAccountSnapshot(
        account({
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
          requirements: { currently_due: [], past_due: [], disabled_reason: null }
        })
      )
    ).toEqual({
      detailsSubmitted: true,
      payoutsEnabled: true,
      transfersActive: true,
      requirementsDue: [],
      disabledReason: null
    });
  });

  it('merges currently due and past due without duplicates', () => {
    const snapshot = toPayoutAccountSnapshot(account());
    expect(snapshot.requirementsDue).toEqual([
      'external_account',
      'individual.dob.day',
      'tos_acceptance.date'
    ]);
    expect(snapshot.transfersActive).toBe(false);
    expect(snapshot.disabledReason).toBe('requirements.past_due');
  });

  it('treats a pending transfers capability and missing requirements as not ready', () => {
    const snapshot = toPayoutAccountSnapshot(
      account({ capabilities: { transfers: 'pending' }, requirements: undefined })
    );
    expect(snapshot.transfersActive).toBe(false);
    expect(snapshot.requirementsDue).toEqual([]);
    expect(snapshot.disabledReason).toBeNull();
  });
});

describe('makeStripeConnectOperations', () => {
  it('creates a Canadian individual Express account with transfers, keyed per user', async () => {
    const { client, calls } = makeFakeStripe();
    const result = await Effect.runPromise(
      makeStripeConnectOperations(client).createPayoutAccount({
        userId: 'helper-1',
        email: 'helper@example.com'
      })
    );
    expect(result).toEqual({ reference: 'acct_123' });
    expect(calls).toEqual([
      {
        method: 'accounts.create',
        args: [
          {
            type: 'express',
            country: 'CA',
            business_type: 'individual',
            email: 'helper@example.com',
            capabilities: { transfers: { requested: true } },
            metadata: { user_id: 'helper-1' }
          },
          { idempotencyKey: 'payout-account:helper-1' }
        ]
      }
    ]);
  });

  it('creates an account_onboarding link and converts its expiry', async () => {
    const { client, calls } = makeFakeStripe();
    const link = await Effect.runPromise(
      makeStripeConnectOperations(client).createOnboardingLink({
        reference: 'acct_123',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      })
    );
    expect(link).toEqual({
      url: 'https://connect.stripe.com/setup/e/acct_123/abc',
      expiresAt: new Date(1790000300 * 1000)
    });
    expect(calls[0]).toEqual({
      method: 'accountLinks.create',
      args: [
        {
          account: 'acct_123',
          type: 'account_onboarding',
          return_url: 'http://localhost:5175/service-provider/payouts?from=stripe',
          refresh_url: 'http://localhost:5175/service-provider/payouts?refresh=1'
        }
      ]
    });
  });

  it('re-fetches the account by reference', async () => {
    const { client, calls } = makeFakeStripe();
    const snapshot = await Effect.runPromise(
      makeStripeConnectOperations(client).getPayoutAccount('acct_123')
    );
    expect(calls).toEqual([{ method: 'accounts.retrieve', args: ['acct_123'] }]);
    expect(snapshot.detailsSubmitted).toBe(false);
  });

  it('creates an Express dashboard login link', async () => {
    const { client, calls } = makeFakeStripe();
    const link = await Effect.runPromise(
      makeStripeConnectOperations(client).createDashboardLink('acct_123')
    );
    expect(link).toEqual({ url: 'https://connect.stripe.com/express/acct_123/login' });
    expect(calls).toEqual([{ method: 'accounts.createLoginLink', args: ['acct_123'] }]);
  });

  it('wraps a Stripe failure in PaymentProviderError naming the operation', async () => {
    const { client } = makeFakeStripe({ failWith: new Error('boom') });
    const exit = await Effect.runPromiseExit(
      makeStripeConnectOperations(client).getPayoutAccount('acct_123')
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain('getPayoutAccount');
    }
  });
});
