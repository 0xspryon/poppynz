import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  makeInMemoryCardDisputeRepo,
  makeInMemorySessionMoneyRepo,
  makeSessionRepoTest,
  makeUserRepoTest,
  type CardDispute,
  type Session,
  type User
} from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  allocateRouteProgram,
  cardDisputeFlagsRouteProgram,
  getCardDisputeRouteProgram,
  listCardDisputesRouteProgram,
  resumeFamilyRouteProgram,
  saveSummaryRouteProgram,
  submitEvidenceRouteProgram,
  suspendFamilyRouteProgram
} from './card-disputes.handler';

/** Tier 3 step 4: the admin card-dispute routes (permission `cardDispute`). */
const SESSION = '0198a3b0-0000-7000-8000-0000000000c1';
const CONTRACT = '0198a3b0-0000-7000-8000-0000000000c2';
const CYCLE = '0198a3b0-0000-7000-8000-0000000000c3';
const NOW = new Date('2026-11-04T12:00:00.000Z');

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const found = Cause.failureOption(exit.cause);
  return Option.isSome(found) ? (found.value as { _tag: string; reason?: string }) : null;
};

const context = (
  params: Record<string, string>,
  body?: unknown,
  query: Record<string, string> = {}
) =>
  ({
    req: {
      param: (key: string) => params[key],
      query: (key: string) => query[key],
      json: async () => body
    }
  }) as unknown as HonoContext<HonoEnv>;

const ADMIN = [
  'cardDispute:read',
  'cardDispute:review',
  'cardDispute:respond',
  'cardDispute:decide',
  'cardDispute:finance'
];
const ACCOUNTANT = ['cardDispute:read', 'cardDispute:finance', 'tax:read', 'refundQueue:read'];
const FAMILY = ['billing:read', 'contract:read'];

const makeWorld = (overrides: Partial<CardDispute> = {}) => {
  const money = makeInMemorySessionMoneyRepo();
  const disputes = makeInMemoryCardDisputeRepo({ money: () => money.state });
  const mock = makeMockPayments();
  const provider = mock.openDispute('pi_1', { amountCents: 6602 });
  const ensured = Effect.runSync(
    disputes.service.ensure({
      dispute: {
        provider: 'mock',
        providerReference: provider.reference,
        paymentId: '0198a3b0-0000-7000-8000-0000000000d1',
        paymentReference: 'pi_1',
        chargeReference: null,
        familyUserId: 'family-1',
        contractId: CONTRACT,
        cycleId: CYCLE,
        scope: 'cycle',
        amountCents: 6602,
        currency: 'cad',
        reason: 'fraudulent',
        status: 'needs_response',
        evidenceDueBy: new Date('2026-11-06T23:59:59.000Z'),
        withdrawnCents: 6602,
        feeCents: 1500,
        providerCreatedAt: new Date('2026-11-03T10:00:00.000Z'),
        syncedAt: new Date('2026-11-03T10:00:00.000Z'),
        ...overrides
      },
      sessions: [
        {
          sessionId: SESSION,
          contractId: CONTRACT,
          cycleId: CYCLE,
          familyTotalCents: 6602,
          helperShareCents: 5266,
          disputedCents: 6602
        }
      ]
    })
  );
  const dispute = ensured.dispute;
  const as = (userId: string, grants: ReadonlyArray<string>) =>
    Layer.mergeAll(
      makeIdleContractBillingLayer(),
      Layer.succeed(Payments, mock),
      money.layer,
      disputes.layer,
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
  const run = <A, E>(effect: Effect.Effect<A, E, any>, userId: string, grants: Array<string>) =>
    Effect.runPromiseExit(effect.pipe(Effect.provide(as(userId, grants))) as Effect.Effect<A, E>);
  return { money, disputes, mock, dispute, provider, run };
};

describe('the card dispute list', () => {
  it('shows admins and the accountant what Poppynz bears', async () => {
    const world = makeWorld();
    for (const [user, grants] of [
      ['admin-1', ADMIN],
      ['acct-1', ACCOUNTANT]
    ] as const) {
      const exit = await world.run(
        listCardDisputesRouteProgram(context({}), new Headers(), NOW),
        user,
        [...grants]
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      const result = Exit.isSuccess(exit) ? exit.value : null;
      expect(result?.disputes).toEqual([
        expect.objectContaining({
          id: world.dispute.id,
          familyName: 'family-1',
          status: 'needs_response',
          money: { withdrawnCents: 6602, reinstatedCents: 0, feeCents: 1500, netCents: 8102 }
        })
      ]);
      expect(result?.totals).toEqual({ netCents: 8102, feeCents: 1500 });
    }
  });

  it('hides the amounts without `finance`', async () => {
    const world = makeWorld();
    const exit = await world.run(
      listCardDisputesRouteProgram(context({}), new Headers(), NOW),
      'admin-2',
      ['cardDispute:read']
    );
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result?.disputes[0]?.money).toBeNull();
    expect(result?.totals).toBeNull();
  });

  it('filters by status and due date', async () => {
    const world = makeWorld();
    const list = async (query: Record<string, string>) => {
      const exit = await world.run(
        listCardDisputesRouteProgram(context({}, undefined, query), new Headers(), NOW),
        'admin-1',
        ADMIN
      );
      return Exit.isSuccess(exit) ? exit.value.disputes.length : -1;
    };
    expect(await list({ status: 'open' })).toBe(1);
    expect(await list({ status: 'closed' })).toBe(0);
    expect(await list({ status: 'all', due: 'week' })).toBe(1);
    expect(await list({ due: 'overdue' })).toBe(0);
    expect(await list({ status: 'nope' })).toBe(-1);
  });

  it('is closed to families and helpers', async () => {
    const world = makeWorld();
    const exit = await world.run(
      listCardDisputesRouteProgram(context({}), new Headers(), NOW),
      'family-1',
      FAMILY
    );
    expect(failure(exit)?._tag).toBe('ForbiddenError');
    const flags = await world.run(cardDisputeFlagsRouteProgram(new Headers()), 'family-1', FAMILY);
    expect(failure(flags)?._tag).toBe('ForbiddenError');
  });

  it('flags the family with an open dispute', async () => {
    const world = makeWorld();
    const exit = await world.run(cardDisputeFlagsRouteProgram(new Headers()), 'acct-1', ACCOUNTANT);
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      families: [{ userId: 'family-1', openDisputes: 1, suspended: false }]
    });
  });
});

describe('one dispute, its evidence and decisions', () => {
  it('opens with its evidence pack for an admin; not for the accountant', async () => {
    const world = makeWorld();
    const exit = await world.run(
      getCardDisputeRouteProgram(context({ id: world.dispute.id }), new Headers()),
      'admin-1',
      ADMIN
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.dispute.pack.sessions).toEqual([
        expect.objectContaining({ sessionId: SESSION, disputedCents: 6602, defaultHelperForfeitCents: 5266 })
      ]);
      expect(exit.value.dispute.suggestedSummary).toContain('Poppynz');
      expect(exit.value.dispute.evidenceFields.uncategorized_text).toBe(
        exit.value.dispute.suggestedSummary
      );
    }
    const accountant = await world.run(
      getCardDisputeRouteProgram(context({ id: world.dispute.id }), new Headers()),
      'acct-1',
      ACCOUNTANT
    );
    expect(failure(accountant)?._tag).toBe('ForbiddenError');
    const missing = await world.run(
      getCardDisputeRouteProgram(
        context({ id: '0198a3b0-0000-7000-8000-0000000000ff' }),
        new Headers()
      ),
      'admin-1',
      ADMIN
    );
    expect(failure(missing)).toMatchObject({ _tag: 'CardDisputeError', reason: 'not_found' });
  });

  it('saves the summary draft, then submits it to the provider (audited)', async () => {
    const world = makeWorld();
    const save = await world.run(
      saveSummaryRouteProgram(
        context({ id: world.dispute.id }, { summary: 'Draft' }),
        new Headers(),
        NOW
      ),
      'admin-1',
      ADMIN
    );
    expect(Exit.isSuccess(save)).toBe(true);
    const submit = await world.run(
      submitEvidenceRouteProgram(
        context({ id: world.dispute.id }, { summary: 'For the bank' }),
        new Headers(),
        NOW
      ),
      'admin-1',
      ADMIN
    );
    expect(Exit.isSuccess(submit) && submit.value.submission.providerStatus).toBe('under_review');
    expect(world.mock.disputeEvidence(world.provider.reference)[0]).toMatchObject({
      submit: true,
      text: expect.objectContaining({ uncategorized_text: 'For the bank' })
    });
    expect(world.money.state.audit.map((row) => [row.action, row.actorUserId])).toEqual([
      ['evidence_summary_saved', 'admin-1'],
      ['evidence_submitted', 'admin-1']
    ]);
    const again = await world.run(
      submitEvidenceRouteProgram(
        context({ id: world.dispute.id }, { summary: 'Again' }),
        new Headers(),
        NOW
      ),
      'admin-1',
      ADMIN
    );
    expect(failure(again)).toMatchObject({ reason: 'already_submitted' });
  });

  it('refuses an empty summary, and evidence from anyone without `respond`', async () => {
    const world = makeWorld();
    const empty = await world.run(
      submitEvidenceRouteProgram(context({ id: world.dispute.id }, { summary: ' ' }), new Headers(), NOW),
      'admin-1',
      ADMIN
    );
    expect(failure(empty)?._tag).toBe('RequestValidationError');
    const accountant = await world.run(
      submitEvidenceRouteProgram(context({ id: world.dispute.id }, { summary: 'x' }), new Headers(), NOW),
      'acct-1',
      ACCOUNTANT
    );
    expect(failure(accountant)?._tag).toBe('ForbiddenError');
  });

  it('allocates a lost dispute’s session (decide), once', async () => {
    const world = makeWorld({ status: 'lost', triage: 'allocation_needed', closedAt: NOW });
    const allocate = (grants: Array<string>, body: unknown) =>
      world.run(
        allocateRouteProgram(context({ id: world.dispute.id }, body), new Headers(), NOW),
        'admin-1',
        grants
      );
    const body = { items: [{ sessionId: SESSION, allocation: 'poppynz_absorbs' }] };
    expect(failure(await allocate(ACCOUNTANT, body))?._tag).toBe('ForbiddenError');
    expect(
      failure(
        await allocate(ADMIN, { items: [{ sessionId: SESSION, allocation: 'helper_not_provided' }] })
      )
    ).toMatchObject({ reason: 'reason_required' });
    const done = await allocate(ADMIN, body);
    expect(Exit.isSuccess(done) && done.value.allocations).toEqual([
      { sessionId: SESSION, allocation: 'poppynz_absorbs', helperForfeitCents: 0, recovered: false }
    ]);
    expect(world.disputes.state.disputes[0]!.triage).toBe('resolved');
    expect(failure(await allocate(ADMIN, body))).toMatchObject({ reason: 'already_allocated' });
    expect(failure(await allocate(ADMIN, { items: [] }))?._tag).toBe('RequestValidationError');
  });

  it('an open dispute is not allocated', async () => {
    const world = makeWorld();
    const exit = await world.run(
      allocateRouteProgram(
        context(
          { id: world.dispute.id },
          { items: [{ sessionId: SESSION, allocation: 'poppynz_absorbs' }] }
        ),
        new Headers(),
        NOW
      ),
      'admin-1',
      ADMIN
    );
    expect(failure(exit)).toMatchObject({ reason: 'not_lost' });
  });
});

describe('suspending and resuming a family’s contracts', () => {
  it('needs `decide`, a reason and a note', async () => {
    const world = makeWorld();
    const suspend = (grants: Array<string>, body: unknown) =>
      world.run(
        suspendFamilyRouteProgram(context({ userId: 'family-1' }, body), new Headers(), NOW),
        'admin-1',
        grants
      );
    const body = { reason: 'suspected_fraud', note: 'card reported stolen' };
    expect(failure(await suspend(ACCOUNTANT, body))?._tag).toBe('ForbiddenError');
    expect(failure(await suspend(ADMIN, { reason: 'suspected_fraud' }))?._tag).toBe(
      'RequestValidationError'
    );
    expect(failure(await suspend(ADMIN, { reason: 'because', note: 'x' }))?._tag).toBe(
      'RequestValidationError'
    );
    // This family has no live contract in the idle world.
    expect(failure(await suspend(ADMIN, body))).toMatchObject({ reason: 'nothing_to_suspend' });
    const resume = await world.run(
      resumeFamilyRouteProgram(context({ userId: 'family-1' }, { note: 'ok' }), new Headers(), NOW),
      'admin-1',
      ADMIN
    );
    expect(failure(resume)).toMatchObject({ reason: 'nothing_to_resume' });
  });
});
