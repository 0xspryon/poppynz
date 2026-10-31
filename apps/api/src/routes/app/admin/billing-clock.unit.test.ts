import { SqlError } from '@effect/sql/SqlError';
import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractBillingRepo,
  dummyContractBilling,
  makeInMemoryBillingClockRunRepo,
  makeInMemoryContractBillingRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type BillingClockRun,
  type Session,
  type User
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { mountedBillingClockRoute } from './billing-clock';
import {
  billingClockCapabilitiesRouteProgram,
  getBillingClockContractRouteProgram,
  isBillingClockEnabled,
  listBillingClockContractsRouteProgram,
  runBillingClockRouteProgram
} from './billing-clock.handler';

/** Staging UAT: the admin billing fast-forward routes (permission `billingClock`). */
const CONTRACT = '0198a3b0-0000-7000-8000-0000000000c2';
const NOW = new Date('2026-11-01T12:00:00.000Z');
const ON = { ENVIRONMENT: 'staging', BILLING_TIME_TRAVEL: 'enabled' };
const ADMIN = ['billingClock:advance'];
const OTHER_ADMIN_TOOLS = ['cardDispute:read', 'payoutQueue:read'];

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const found = Cause.failureOption(exit.cause);
  return Option.isSome(found) ? (found.value as { _tag: string; reason?: string }) : null;
};

const context = (params: Record<string, string>, body?: unknown) =>
  ({
    req: {
      param: (key: string) => params[key],
      query: () => undefined,
      json: async () => {
        if (body === undefined) throw new Error('no body');
        return body;
      }
    }
  }) as unknown as HonoContext<HonoEnv>;

const makeWorld = (
  options: {
    runs?: ReadonlyArray<BillingClockRun>;
    billingRepo?: Context.Tag.Service<typeof ContractBillingRepo>;
  } = {}
) => {
  // A contract that has ended: its tick does nothing, so the run is quick.
  const billing = makeInMemoryContractBillingRepo({
    billing: [dummyContractBilling({ contractId: CONTRACT, status: 'ended' })]
  });
  const runs = makeInMemoryBillingClockRunRepo(options.runs);
  const as = (grants: ReadonlyArray<string>) =>
    Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, makeMockPayments()),
      options.billingRepo ? Layer.succeed(ContractBillingRepo, options.billingRepo) : billing.layer,
      runs.layer,
      makeAuthServiceTest({
        getSession: () => Effect.succeed({ user: { id: 'admin-1' }, session: { id: 'session-1' } }),
        userHasPermission: (_headers, permissions) =>
          Effect.succeed(
            Object.entries(permissions).every(([resource, actions]) =>
              (actions as Array<string>).every((action) => grants.includes(`${resource}:${action}`))
            )
          )
      }),
      makeUserRepoTest({
        findById: (id) => Effect.succeed({ id, name: id, email: `${id}@x.test` } as User),
        findByEmail: () => Effect.die('unused')
      }),
      makeSessionRepoTest({
        findById: () => Effect.succeed({ id: 'session-1', userId: 'admin-1' } as Session)
      })
    );
  const run = <A, E>(effect: Effect.Effect<A, E, any>, grants: ReadonlyArray<string> = ADMIN) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(as(grants))) as Effect.Effect<A, E>);
  return { billing, runs, run };
};

const headers = new Headers();
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

describe('the billing clock switch', () => {
  it('mounts the routes only in staging or dev with BILLING_TIME_TRAVEL=enabled and test keys', () => {
    expect(isBillingClockEnabled(ON)).toBe(true);
    expect(isBillingClockEnabled({ ...ON, ENVIRONMENT: 'dev' })).toBe(true);
    expect(
      isBillingClockEnabled({ ...ON, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' })
    ).toBe(true);
    for (const env of [
      { ...ON, ENVIRONMENT: 'production' },
      { BILLING_TIME_TRAVEL: 'enabled' },
      { ENVIRONMENT: 'staging' },
      { ...ON, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x' },
      { ...ON, PAYMENTS_PROVIDER: 'stripe' }
    ]) {
      expect(isBillingClockEnabled(env)).toBe(false);
    }
    expect(mountedBillingClockRoute(ON).routes.map((route) => route.path)).toEqual([
      '/contracts',
      '/contracts/:id',
      '/contracts/:id/runs'
    ]);
    expect(mountedBillingClockRoute({ ...ON, ENVIRONMENT: 'production' }).routes).toHaveLength(0);
    expect(mountedBillingClockRoute({}).routes).toHaveLength(0);
  });

  it('answers 404 (disabled) from every program when the switch is off, even for an admin', async () => {
    const world = makeWorld();
    const off = { ...ON, BILLING_TIME_TRAVEL: 'disabled' };
    for (const exit of [
      await world.run(listBillingClockContractsRouteProgram(headers, off, NOW)),
      await world.run(getBillingClockContractRouteProgram(context({ id: CONTRACT }), headers, off, NOW)),
      await world.run(
        runBillingClockRouteProgram(
          context({ id: CONTRACT }, { until: later(2) }),
          headers,
          off,
          NOW
        )
      )
    ]) {
      expect(failure(exit)?._tag).toBe('BillingClockDisabledError');
    }
    expect(world.runs.state.runs).toEqual([]);
  });

  it('tells the admin nav whether the billing clock is on for this user', async () => {
    const world = makeWorld();
    const on = await world.run(billingClockCapabilitiesRouteProgram(headers, ON));
    expect(Exit.isSuccess(on) && on.value).toEqual({ billingClock: { enabled: true, maxDays: 60 } });
    const off = await world.run(billingClockCapabilitiesRouteProgram(headers, {}));
    expect(Exit.isSuccess(off) && off.value).toEqual({
      billingClock: { enabled: false, maxDays: null }
    });
    const denied = await world.run(billingClockCapabilitiesRouteProgram(headers, ON), []);
    expect(Exit.isSuccess(denied) && denied.value).toEqual({
      billingClock: { enabled: false, maxDays: null }
    });
  });
});

describe('the billing clock routes', () => {
  it('refuse an admin without the billingClock permission', async () => {
    const world = makeWorld();
    for (const exit of [
      await world.run(listBillingClockContractsRouteProgram(headers, ON, NOW), OTHER_ADMIN_TOOLS),
      await world.run(
        getBillingClockContractRouteProgram(context({ id: CONTRACT }), headers, ON, NOW),
        OTHER_ADMIN_TOOLS
      ),
      await world.run(
        runBillingClockRouteProgram(context({ id: CONTRACT }, { until: later(2) }), headers, ON, NOW),
        OTHER_ADMIN_TOOLS
      )
    ]) {
      expect(failure(exit)?._tag).toBe('ForbiddenError');
    }
    expect(world.runs.state.runs).toEqual([]);
  });

  it('runs a contract up to an instant and audits it', async () => {
    const world = makeWorld();
    const exit = await world.run(
      runBillingClockRouteProgram(context({ id: CONTRACT }, { until: later(30) }), headers, ON, NOW)
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value.run).toMatchObject({
      contractId: CONTRACT,
      actorName: 'admin-1',
      targetAt: later(30),
      status: 'succeeded',
      billingStatusBefore: 'ended',
      billingStatusAfter: 'ended',
      eventKind: null
    });
    expect(world.runs.state.runs).toHaveLength(1);

    const detail = await world.run(
      getBillingClockContractRouteProgram(context({ id: CONTRACT }), headers, ON, NOW)
    );
    expect(Exit.isSuccess(detail) && detail.value.runs.map((run) => run.status)).toEqual([
      'succeeded'
    ]);
    expect(Exit.isSuccess(detail) && detail.value.contract.status).toBe('ended');

    const list = await world.run(listBillingClockContractsRouteProgram(headers, ON, NOW));
    // Ended contracts aren't live; the run is still listed.
    expect(Exit.isSuccess(list) && list.value.contracts).toEqual([]);
    expect(Exit.isSuccess(list) && list.value.runs).toHaveLength(1);
  });

  it('validates the contract id and the instant', async () => {
    const world = makeWorld();
    const invalid = async (params: Record<string, string>, body?: unknown) =>
      failure(
        await world.run(runBillingClockRouteProgram(context(params, body), headers, ON, NOW))
      );
    expect(await invalid({ id: 'nope' }, { until: later(2) })).toMatchObject({
      _tag: 'RequestValidationError'
    });
    expect(await invalid({ id: CONTRACT })).toMatchObject({ _tag: 'RequestValidationError' });
    expect(await invalid({ id: CONTRACT }, { until: 'tomorrow' })).toMatchObject({
      _tag: 'RequestValidationError'
    });
    expect(await invalid({ id: CONTRACT }, { until: '2026-11-02' })).toMatchObject({
      _tag: 'RequestValidationError'
    });
    expect(await invalid({ id: CONTRACT }, { until: later(-1) })).toMatchObject({
      _tag: 'BillingClockError',
      reason: 'not_in_future'
    });
    expect(await invalid({ id: CONTRACT }, { until: later(61 * 24) })).toMatchObject({
      _tag: 'BillingClockError',
      reason: 'too_far'
    });
    expect(
      await invalid({ id: '0198a3b0-0000-7000-8000-0000000000ff' }, { until: later(2) })
    ).toMatchObject({ _tag: 'BillingClockError', reason: 'not_found' });
    expect(
      failure(
        await world.run(
          getBillingClockContractRouteProgram(
            context({ id: '0198a3b0-0000-7000-8000-0000000000ff' }),
            headers,
            ON,
            NOW
          )
        )
      )
    ).toMatchObject({ _tag: 'BillingClockError', reason: 'not_found' });
    expect(world.runs.state.runs).toEqual([]);
  });

  it('refuses a second run of a contract while one is in progress', async () => {
    const world = makeWorld({
      runs: [
        {
          id: 'running',
          contractId: CONTRACT,
          actorUserId: 'admin-2',
          targetAt: new Date(later(5)),
          eventKind: null,
          eventLabel: null,
          status: 'running',
          billingStatusBefore: 'active',
          billingStatusAfter: null,
          summary: null,
          error: null,
          startedAt: new Date(NOW.getTime() - 60_000),
          finishedAt: null,
          createdAt: NOW
        }
      ]
    });
    const exit = await world.run(
      runBillingClockRouteProgram(context({ id: CONTRACT }, { until: later(2) }), headers, ON, NOW)
    );
    expect(failure(exit)).toMatchObject({ _tag: 'BillingClockError', reason: 'already_running' });
  });

  it('translates repository failures into one infrastructure error', async () => {
    const boom = new SqlError({ cause: new Error('db down'), message: 'db down' });
    const world = makeWorld({
      billingRepo: {
        findBilling: () => Effect.fail(boom),
        listLiveBilling: () => Effect.fail(boom),
        listCycles: () => Effect.fail(boom)
      } as unknown as Context.Tag.Service<typeof ContractBillingRepo>
    });
    for (const exit of [
      await world.run(listBillingClockContractsRouteProgram(headers, ON, NOW)),
      await world.run(getBillingClockContractRouteProgram(context({ id: CONTRACT }), headers, ON, NOW)),
      await world.run(
        runBillingClockRouteProgram(context({ id: CONTRACT }, { until: later(2) }), headers, ON, NOW)
      )
    ]) {
      expect(failure(exit)?._tag).toBe('BillingClockRepoError');
    }
  });
});
