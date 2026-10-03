import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type AppliedPayoutSnapshot,
  type PayoutAccount,
  type Session,
  type User
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError } from '@repo/payments';
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { readySnapshot } from '@/api/lib/payouts.test-support';
import {
  getPayoutsRouteProgram,
  payoutsDashboardRouteProgram,
  refreshPayoutsRouteProgram,
  startPayoutsOnboardingRouteProgram
} from './payouts.handler';
import { payoutsRoute } from './payouts';

const helper = (): User => ({
  id: 'helper-1',
  name: 'Priya Helper',
  email: 'priya@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  isAnonymous: false,
  role: 'service-provider',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
});

const session = (): Session => ({
  id: 'session-1',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'helper-1',
  impersonatedBy: null,
  activeOrganizationId: null
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

type Recorded = {
  created: Array<{ userId: string; email: string }>;
  links: Array<{ reference: string; returnUrl: string; refreshUrl: string }>;
  fetched: Array<string>;
  dashboards: Array<string>;
  applied: Array<AppliedPayoutSnapshot>;
};

const makeLayer = (
  options: {
    hasPermission?: boolean;
    accounts?: Array<PayoutAccount>;
    snapshot?: ReturnType<typeof readySnapshot>;
    providerFails?: boolean;
    recorded?: Recorded;
  } = {}
) => {
  const recorded = options.recorded ?? {
    created: [],
    links: [],
    fetched: [],
    dashboards: [],
    applied: []
  };
  const providerFailure = (operation: 'createPayoutAccount' | 'getPayoutAccount') =>
    Effect.fail(new PaymentProviderError({ operation, cause: 'stripe down' }));
  const { layer: repoLayer } = makeInMemoryPayoutAccountRepo(
    options.accounts ?? [],
    recorded.applied
  );
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: 'helper-1' }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(helper()),
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session()) }),
    repoLayer,
    makePaymentsTest({
      provider: 'stripe',
      createPayoutAccount: (input) => {
        recorded.created.push(input);
        return options.providerFails
          ? providerFailure('createPayoutAccount')
          : Effect.succeed({ reference: 'acct_new' });
      },
      createOnboardingLink: (input) => {
        recorded.links.push(input);
        return Effect.succeed({
          url: `https://connect.stripe.com/setup/e/${input.reference}/abc`,
          expiresAt: new Date(Date.now() + 300_000)
        });
      },
      getPayoutAccount: (reference) => {
        recorded.fetched.push(reference);
        return options.providerFails
          ? providerFailure('getPayoutAccount')
          : Effect.succeed(options.snapshot ?? readySnapshot());
      },
      createDashboardLink: (reference) => {
        recorded.dashboards.push(reference);
        return Effect.succeed({ url: `https://connect.stripe.com/express/${reference}` });
      }
    })
  );
};

const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /payouts', () => {
  it('reports no account yet', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(result).toEqual({
      status: null,
      paymentReady: false,
      requirementsDue: [],
      provider: 'stripe',
      hasAccount: false
    });
  });

  it('serves a snapshot younger than the refresh window without calling Stripe', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(30) })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'onboarding', paymentReady: false, hasAccount: true });
    expect(recorded.fetched).toEqual([]);
  });

  it('re-fetches a snapshot older than 1 hour and stores it', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(61) })]
          })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
    expect(recorded.applied).toHaveLength(1);
    expect(result).toMatchObject({ status: 'ready', paymentReady: true });
  });

  it('honours PAYOUTS_REFRESH_AFTER_MINUTES', async () => {
    vi.stubEnv('PAYOUTS_REFRESH_AFTER_MINUTES', '10');
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ recorded, accounts: [dummyPayoutAccount({ refreshedAt: minutesAgo(15) })] })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
  });

  it('keeps the stored state when Stripe is down', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            providerFails: true,
            accounts: [dummyPayoutAccount({ status: 'onboarding', refreshedAt: minutesAgo(90) })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'onboarding', hasAccount: true });
  });

  it('lists what Stripe needs as readable labels', async () => {
    const result = await Effect.runPromise(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            accounts: [
              dummyPayoutAccount({
                status: 'restricted',
                detailsSubmitted: true,
                requirementsDue: ['external_account', 'individual.verification.document'],
                refreshedAt: minutesAgo(1)
              })
            ]
          })
        )
      )
    );
    expect(result.requirementsDue).toEqual(['A bank account for your payouts', 'Photo ID']);
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      getPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('POST /payouts/onboarding', () => {
  it('creates the account once, stores it and returns the Stripe link', async () => {
    vi.stubEnv('APP_WEB_ORIGIN', 'http://localhost:5175/');
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded }))
      )
    );
    expect(recorded.created).toEqual([{ userId: 'helper-1', email: 'priya@example.com' }]);
    expect(recorded.links).toEqual([
      {
        reference: 'acct_new',
        returnUrl: 'http://localhost:5175/service-provider/payouts?from=stripe',
        refreshUrl: 'http://localhost:5175/service-provider/payouts?refresh=1'
      }
    ]);
    expect(result).toEqual({ url: 'https://connect.stripe.com/setup/e/acct_new/abc' });
  });

  it('defaults the return origin to https://app.poppynz.com', async () => {
    vi.stubEnv('APP_WEB_ORIGIN', undefined);
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded }))
      )
    );
    expect(recorded.links[0].returnUrl).toBe(
      'https://app.poppynz.com/service-provider/payouts?from=stripe'
    );
  });

  it('reuses an existing account instead of creating another', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ recorded, accounts: [dummyPayoutAccount()] }))
      )
    );
    expect(recorded.created).toEqual([]);
    expect(recorded.links[0].reference).toBe('acct_123');
  });

  it('replaces an account left by another provider (mock → stripe) with a Stripe one', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    await Effect.runPromise(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            recorded,
            accounts: [
              dummyPayoutAccount({
                provider: 'mock',
                accountReference: 'mock_acct_helper-1',
                status: 'ready'
              })
            ]
          })
        )
      )
    );
    expect(recorded.created).toEqual([{ userId: 'helper-1', email: 'priya@example.com' }]);
    expect(recorded.links[0].reference).toBe('acct_new');
  });

  it('fails with PayoutsProviderError when Stripe refuses', async () => {
    const exit = await Effect.runPromiseExit(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ providerFails: true }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'PayoutsProviderError' });
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      startPayoutsOnboardingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

describe('POST /payouts/refresh', () => {
  it('re-fetches even a fresh snapshot', async () => {
    const recorded: Recorded = { created: [], links: [], fetched: [], dashboards: [], applied: [] };
    const result = await Effect.runPromise(
      refreshPayoutsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ recorded, accounts: [dummyPayoutAccount({ refreshedAt: new Date() })] })
        )
      )
    );
    expect(recorded.fetched).toEqual(['acct_123']);
    expect(result).toMatchObject({ status: 'ready', paymentReady: true, hasAccount: true });
  });

  it('fails with NoPayoutAccountError without an account', async () => {
    const exit = await Effect.runPromiseExit(
      refreshPayoutsRouteProgram(new Headers()).pipe(Effect.provide(makeLayer()))
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'NoPayoutAccountError' });
  });
});

describe('POST /payouts/dashboard', () => {
  it('returns the Express dashboard link', async () => {
    const result = await Effect.runPromise(
      payoutsDashboardRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ accounts: [dummyPayoutAccount({ status: 'ready' })] }))
      )
    );
    expect(result).toEqual({ url: 'https://connect.stripe.com/express/acct_123' });
  });

  it('answers 409 NO_PAYOUT_ACCOUNT without an account', async () => {
    const runtime = ManagedRuntime.make(makeLayer());
    const app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('runtime', runtime as never);
        await next();
      })
      .route('/payouts', payoutsRoute);
    const response = await app.request('/payouts/dashboard', { method: 'POST' });
    const body = await response.json();
    await runtime.dispose();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: { code: 'NO_PAYOUT_ACCOUNT' } });
  });

  it('fails with ForbiddenError without the payouts permission', async () => {
    const exit = await Effect.runPromiseExit(
      payoutsDashboardRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ hasPermission: false }))
      )
    );
    expect(failureOf(exit)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});
