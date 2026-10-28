import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  makeInMemoryExtraSessionRepo,
  makeInMemorySessionMoneyRepo,
  type ExtraSession,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Session,
  type SessionRefund,
  type User
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  decideManualPayoutRouteProgram,
  listFailedRefundsRouteProgram,
  listPayoutQueueRouteProgram,
  listUnpaidExtraSessionsRouteProgram,
  markRefundHandledRouteProgram,
  recordManualPayoutRouteProgram,
  retryRefundRouteProgram
} from './money.handler';

/** Tier 3 step 2: the manual payout queue and the refund-failure list. */
const TRANSFER = '0198a3b0-0000-7000-8000-0000000000a1';
const REFUND = '0198a3b0-0000-7000-8000-0000000000b1';

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const found = Cause.failureOption(exit.cause);
  return Option.isSome(found) ? (found.value as { _tag: string; reason?: string }) : null;
};

const context = (params: Record<string, string>, body?: unknown) =>
  ({
    req: { param: (key: string) => params[key], json: async () => body }
  }) as unknown as HonoContext<HonoEnv>;

const makeWorld = () => {
  const money = makeInMemorySessionMoneyRepo();
  const refund = {
    id: REFUND,
    refundKey: 'k',
    sessionId: 's-1',
    resolutionId: 'r-1',
    cycleId: 'c-1',
    contractId: 'k-1',
    paymentId: 'p-1',
    careCents: 5039,
    careTaxLines: [],
    careTaxCents: 0,
    feeCents: 0,
    feeTaxLines: [],
    feeTaxCents: 0,
    totalCents: 5039,
    commissionCents: 0,
    commissionTaxLines: [],
    status: 'failed',
    attempts: 1,
    providerReference: 're_1',
    failureReason: 'card closed',
    noticesSent: [],
    refundedAt: null,
    resolvedByUserId: null,
    resolvedNote: null,
    handledAt: null,
    createdAt: new Date('2026-11-04T08:00:00.000Z'),
    updatedAt: new Date('2026-11-04T08:00:00.000Z')
  } satisfies SessionRefund;
  money.state.refunds.push(refund);
  money.state.transfers.push({
    id: TRANSFER,
    cycleId: 'c-1',
    contractId: 'k-1',
    helperUserId: 'helper-1',
    sequence: 1,
    status: 'manual_review',
    dueAt: new Date('2026-11-07T05:00:00.000Z'),
    grossCents: 10531,
    recoveredCents: 0,
    amountCents: 10531,
    attempts: 0,
    providerReference: null,
    sourceReference: null,
    failureReason: null,
    noticesSent: [],
    fixedAt: new Date('2027-01-06T06:00:00.000Z'),
    sentAt: null,
    paidAt: null,
    payoutReference: null,
    payoutMatch: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const as = (userId: string, grants: ReadonlyArray<string>) =>
    Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, makeMockPayments()),
      money.layer,
      makeAuthServiceTest({
        getSession: () => Effect.succeed({ user: { id: userId }, session: { id: 'session-1' } }),
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
        findById: () => Effect.succeed({ id: 'session-1', userId } as Session)
      })
    );
  return { money, as };
};

const ADMIN = [
  'payoutQueue:read',
  'payoutQueue:record',
  'payoutQueue:approve',
  'refundQueue:read',
  'refundQueue:write'
];
const ACCOUNTANT = ['refundQueue:read', 'refundQueue:write', 'tax:read', 'taxReport:read'];
const NOW = new Date('2027-01-07T00:00:00.000Z');

describe('the manual payout queue', () => {
  it('lists transfers that could not be sent', async () => {
    const world = makeWorld();
    const result = await Effect.runPromise(
      listPayoutQueueRouteProgram(new Headers()).pipe(Effect.provide(world.as('admin-1', ADMIN)))
    );
    expect(result.transfers).toEqual([
      expect.objectContaining({ id: TRANSFER, status: 'manual_review', amountCents: 10531 })
    ]);
  });

  it('records with one admin and approves with another; the same admin cannot approve', async () => {
    const world = makeWorld();
    const record = await Effect.runPromiseExit(
      recordManualPayoutRouteProgram(
        context(
          { id: TRANSFER },
          {
            method: 'interac_etransfer',
            reference: 'ET-1',
            amountCents: 10531,
            reason: 'restricted'
          }
        ),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as('admin-1', ADMIN)))
    );
    expect(record._tag).toBe('Success');
    const manualId = world.money.state.manualPayouts[0]!.id;
    const decide = (actor: string) =>
      Effect.runPromiseExit(
        decideManualPayoutRouteProgram(
          context({ id: manualId }, { decision: 'approved' }),
          new Headers(),
          NOW
        ).pipe(Effect.provide(world.as(actor, ADMIN)))
      );
    expect(failure(await decide('admin-1'))).toMatchObject({
      _tag: 'MoneyAdminError',
      reason: 'same_admin'
    });
    expect((await decide('admin-2'))._tag).toBe('Success');
    expect(world.money.state.transfers[0]!.status).toBe('manual_paid');
    expect(world.money.state.audit.map((row) => row.action)).toEqual(['recorded', 'approved']);
  });

  it('refuses an amount other than the transfer’s', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      recordManualPayoutRouteProgram(
        context(
          { id: TRANSFER },
          { method: 'cheque', reference: 'C-1', amountCents: 100, reason: 'x' }
        ),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as('admin-1', ADMIN)))
    );
    expect(failure(exit)).toMatchObject({ reason: 'amount_mismatch' });
  });

  it('is closed to the accountant (no payoutQueue permission)', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      listPayoutQueueRouteProgram(new Headers()).pipe(
        Effect.provide(world.as('acct-1', ACCOUNTANT))
      )
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });
});

describe('the refund-failure list', () => {
  it('is open to the accountant, who can mark a refund handled (audited)', async () => {
    const world = makeWorld();
    const list = await Effect.runPromise(
      listFailedRefundsRouteProgram(new Headers()).pipe(
        Effect.provide(world.as('acct-1', ACCOUNTANT))
      )
    );
    expect(list.refunds).toEqual([
      expect.objectContaining({ id: REFUND, failureReason: 'card closed' })
    ]);
    const exit = await Effect.runPromiseExit(
      markRefundHandledRouteProgram(
        context({ id: REFUND }, { note: 'Paid by e-Transfer ET-9' }),
        new Headers(),
        NOW
      ).pipe(Effect.provide(world.as('acct-1', ACCOUNTANT)))
    );
    expect(exit._tag).toBe('Success');
    expect(world.money.state.refunds[0]).toMatchObject({
      status: 'cancelled',
      resolvedNote: 'Paid by e-Transfer ET-9',
      // Tier 3 step 5: dated, so it counts as refunded for tax that month.
      handledAt: NOW
    });
    expect(world.money.state.audit.map((row) => row.action)).toEqual(['handled']);
  });

  it('retries a failed refund under a new key', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      retryRefundRouteProgram(context({ id: REFUND }), new Headers(), NOW).pipe(
        Effect.provide(world.as('admin-1', ADMIN))
      )
    );
    expect(exit._tag).toBe('Success');
    expect(world.money.state.refunds[0]!.status).toBe('pending');
    expect(world.money.state.refunds[0]!.noticesSent).toContain('retry:1');
  });

  it('needs the refundQueue permission', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      listFailedRefundsRouteProgram(new Headers()).pipe(Effect.provide(world.as('family-1', [])))
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });
});

describe('unpaid extra sessions (Tier 3 step 3)', () => {
  const extras = makeInMemoryExtraSessionRepo({
    extras: [
      {
        id: 'extra-1',
        contractId: 'k-1',
        cycleId: 'c-1',
        date: '2026-11-03',
        startMinutes: 600,
        endMinutes: 720,
        serviceName: 'Childcare',
        status: 'charge_failed',
        quotedTotalCents: 5283,
        familyTotalCents: 5283,
        chargeAttempts: 3,
        lastError: 'Your card was declined.',
        chargeAt: new Date('2026-11-05T15:00:00.000Z'),
        nextRetryAt: new Date('2026-11-13T03:00:00.000Z'),
        noticesSent: ['unpaid_alert'],
        updatedAt: new Date()
      } as unknown as ExtraSession,
      { id: 'extra-2', status: 'charged', noticesSent: [] } as unknown as ExtraSession
    ]
  });

  it('lists the declined and in-flight ones, flagged once alerted', async () => {
    const world = makeWorld();
    const result = await Effect.runPromise(
      listUnpaidExtraSessionsRouteProgram(new Headers()).pipe(
        Effect.provide(Layer.mergeAll(world.as('admin-1', ADMIN), extras.layer))
      )
    );
    expect(result.extraSessions).toEqual([
      expect.objectContaining({
        id: 'extra-1',
        status: 'charge_failed',
        totalCents: 5283,
        attempts: 3,
        lastError: 'Your card was declined.',
        alerted: true
      })
    ]);
  });

  it('is for the payout queue (admins), not the accountant', async () => {
    const world = makeWorld();
    const exit = await Effect.runPromiseExit(
      listUnpaidExtraSessionsRouteProgram(new Headers()).pipe(
        Effect.provide(Layer.mergeAll(world.as('accountant-1', ACCOUNTANT), extras.layer))
      )
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
  });
});
