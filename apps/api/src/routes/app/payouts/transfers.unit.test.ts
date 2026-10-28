import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractRepo,
  dummyContract,
  dummyContractCycle,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionMoneyRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Session,
  type User
} from '@repo/db';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { listHelperTransfersRouteProgram, transferDisplayStatus } from './transfers';

/** Tier 3 step 2: the helper's Payouts page lists their transfers. */
const layerFor = (viewer: string, hasPermission = true) => {
  const billing = makeInMemoryContractBillingRepo();
  billing.state.cycles.push(dummyContractCycle({ id: 'cycle-1', contractId: 'contract-1' }));
  const money = makeInMemorySessionMoneyRepo({ billing: billing.state });
  const transfer = Effect.runSync(
    money.service.ensureTransfer({
      cycleId: 'cycle-1',
      contractId: 'contract-1',
      helperUserId: 'helper-1',
      sequence: 1,
      status: 'due',
      dueAt: new Date('2026-11-07T05:00:00.000Z')
    })
  );
  Effect.runSync(
    money.service.fixTransfer(transfer.id, {
      from: ['due'],
      set: {
        status: 'sent',
        grossCents: 10531,
        recoveredCents: 0,
        amountCents: 10531,
        sentAt: new Date('2026-11-07T05:01:00.000Z')
      },
      items: [
        { kind: 'session', sessionId: 's-1', amountCents: 5265 },
        { kind: 'held', sessionId: 's-2', amountCents: 0 }
      ],
      recoveries: [],
      ledger: []
    })
  );
  return Layer.mergeAll(
    makeIdleContractBillingLayer(),
    billing.layer,
    money.layer,
    Layer.succeed(ContractRepo, {
      findById: () =>
        Effect.succeed({
          ...dummyContract,
          id: 'contract-1',
          familyUserId: 'family-1',
          providerUserId: 'helper-1'
        })
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(hasPermission)
    }),
    makeUserRepoTest({
      findById: (id) =>
        Effect.succeed({
          id,
          name: id === 'family-1' ? 'Priya Tester' : id,
          email: 'x@x.test'
        } as User),
      findByEmail: () => Effect.die('unused')
    }),
    makeSessionRepoTest({
      findById: () => Effect.succeed({ id: 'session-1', userId: viewer } as Session)
    })
  );
};

describe('GET /payouts/transfers', () => {
  it('lists the helper’s transfers per cycle with their session breakdown', async () => {
    const result = await Effect.runPromise(
      listHelperTransfersRouteProgram(new Headers()).pipe(Effect.provide(layerFor('helper-1')))
    );
    expect(result.transfers).toEqual([
      expect.objectContaining({
        status: 'arriving',
        amountCents: 10531,
        cycleStartsOn: '2026-11-02',
        items: [
          expect.objectContaining({ kind: 'session', amountCents: 5265 }),
          expect.objectContaining({ kind: 'held', amountCents: 0 })
        ]
      })
    ]);
  });

  it('shows nobody else’s transfers', async () => {
    const result = await Effect.runPromise(
      listHelperTransfersRouteProgram(new Headers()).pipe(Effect.provide(layerFor('helper-2')))
    );
    expect(result.transfers).toEqual([]);
  });

  it('needs the payouts read permission', async () => {
    const exit = await Effect.runPromiseExit(
      listHelperTransfersRouteProgram(new Headers()).pipe(
        Effect.provide(layerFor('helper-1', false))
      )
    );
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
    expect(Option.isSome(failure) && (failure.value as { _tag: string })._tag).toBe(
      'ForbiddenError'
    );
  });

  it('labels each state as the helper reads it', () => {
    expect(
      (
        [
          'due',
          'paused',
          'sending',
          'sent',
          'paid',
          'failed',
          'settled',
          'manual_review',
          'manual_paid'
        ] as const
      ).map(transferDisplayStatus)
    ).toEqual([
      'scheduled',
      'held',
      'sending',
      'arriving',
      'sent',
      'failed',
      'nothing_due',
      'held',
      'sent'
    ]);
  });
});
