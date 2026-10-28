import { makeIdleContractBillingLayer } from '@repo/billing';
import {
  ContractRepo,
  DBNotFoundError,
  dummyContract,
  dummyContractBilling,
  dummyContractCycle,
  dummyContractVersion,
  makeInMemoryContractBillingRepo,
  makeInMemoryExtraSessionRepo,
  makeSeededTaxConfigRepo,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type ContractBilling,
  type User
} from '@repo/db';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { NoopNotificationHubTest } from '@repo/notify';
import { makeMockPayments, Payments } from '@repo/payments';
import { Context, Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  cancelExtraSessionRouteProgram,
  listExtraSessionsRouteProgram,
  proposeExtraSessionRouteProgram,
  quoteExtraSessionRouteProgram,
  respondToExtraSessionRouteProgram,
  withdrawExtraSessionRouteProgram
} from './extra-sessions';
import { extraSessionRouteErrorToResponse } from './extra-sessions.handler';
import {
  CONTRACT_ID,
  CYCLE_ID,
  FAMILY,
  HELPER,
  OUTSIDER,
  failureOf,
  makeContext,
  session
} from './sessions.test-support';

/**
 * Tier 3 step 3 routes: parsing, validation, permissions, the party check
 * and error translation around `@repo/billing`'s extra-session rules (whose
 * own suite covers the rules and the charge). The contract: Mon 2 Nov 2026
 * onwards in Toronto, Childcare at $25/h; Mon 2 Nov has 15:30–17:30.
 */
type Grant = 'extraSession:read' | 'extraSession:write';
const PARTY: ReadonlyArray<Grant> = ['extraSession:read', 'extraSession:write'];
const NOW = new Date('2026-10-30T12:00:00.000Z');
/** Tue 3 Nov 10:00–12:00: $50.00 of care → $52.83 for the family. */
const SLOT = { date: '2026-11-03', startMinutes: 600, endMinutes: 720, serviceId: 'svc-1' };

const makeWorld = (
  options: { viewer?: User; grants?: ReadonlyArray<Grant>; billing?: Partial<ContractBilling> } = {}
) => {
  const viewer = options.viewer ?? FAMILY;
  const grants = new Set(options.grants ?? PARTY);
  const billing = makeInMemoryContractBillingRepo({
    billing: [
      dummyContractBilling({
        contractId: CONTRACT_ID,
        acceptedVersionId: 'version-1',
        timeZone: 'America/Toronto',
        startsOn: '2026-11-02',
        materialisedThrough: '2026-11-12',
        status: 'active',
        ...options.billing
      })
    ]
  });
  billing.state.cycles.push(
    dummyContractCycle({
      id: CYCLE_ID,
      contractId: CONTRACT_ID,
      startsOn: '2026-11-02',
      endsOn: '2026-11-04'
    })
  );
  billing.state.sessions.push({
    ...session({ date: '2026-11-02' }),
    startsAt: new Date('2026-11-02T20:30:00.000Z'),
    endsAt: new Date('2026-11-02T22:30:00.000Z'),
    compensationCents: 0,
    origin: 'scheduled',
    chargeRoute: 'cycle'
  });
  const extras = makeInMemoryExtraSessionRepo({ billing: billing.state, clock: () => NOW });
  const mails: Array<ContractBillingNoticeMail> = [];
  const users = [FAMILY, HELPER, OUTSIDER];
  const version = {
    ...dummyContractVersion,
    id: 'version-1',
    contractId: CONTRACT_ID,
    status: 'accepted' as const,
    timeZone: 'America/Toronto',
    startsOn: '2026-11-02',
    services: [
      {
        serviceId: 'svc-1',
        name: 'Childcare',
        listedRateCents: 2500,
        rateCents: 2500,
        currency: 'CAD',
        sessions: [{ weekday: 0, startMinutes: 930, endMinutes: 1050 }],
        expectations: ''
      }
    ]
  };
  const layer = Layer.mergeAll(
    makeIdleContractBillingLayer(),
    Layer.succeed(Payments, makeMockPayments()),
    billing.layer,
    extras.layer,
    makeSeededTaxConfigRepo().layer,
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer.id }, session: { id: 'session-1' } }),
      userHasPermission: (_headers, permissions) =>
        Effect.succeed(
          Object.entries(permissions).every(([resource, actions]) =>
            (actions as Array<string>).every((action) =>
              grants.has(`${resource}:${action}` as Grant)
            )
          )
        )
    }),
    makeUserRepoTest({
      findById: (id) => {
        const found = users.find((row) => row.id === id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(new DBNotFoundError({ entity: 'user', value: id }));
      },
      findByEmail: () => Effect.die('unused')
    }),
    makeSessionRepoTest({
      findById: () =>
        Effect.succeed({ id: 'session-1', userId: viewer.id, impersonatedBy: null } as never)
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          firstName: userId === 'family-1' ? 'Priya' : 'Maria',
          lastName: 'Tester',
          language: userId === 'helper-1' ? 'fr' : 'en'
        } as never),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    }),
    Layer.succeed(ContractRepo, {
      findById: (id: string) =>
        Effect.succeed(
          id === CONTRACT_ID
            ? {
                ...dummyContract,
                id: CONTRACT_ID,
                familyUserId: 'family-1',
                providerUserId: 'helper-1',
                status: 'active' as const
              }
            : null
        ),
      listVersions: () => Effect.succeed([version])
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    makeMailerTest({
      sendContractBillingNotice: (mail) => Effect.sync(() => void mails.push(mail))
    }),
    NoopNotificationHubTest
  );
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromiseExit(effect);
  const provide = <A, E>(effect: Effect.Effect<A, E, any>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
  return { layer, billing, extras, mails, run, provide };
};

type World = ReturnType<typeof makeWorld>;

const propose = (w: World, body: unknown, now = NOW) =>
  w.run(
    w.provide(
      proposeExtraSessionRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body }),
        new Headers(),
        now
      )
    )
  );
const quote = (w: World, body: unknown) =>
  w.run(
    w.provide(
      quoteExtraSessionRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body }),
        new Headers(),
        NOW
      )
    )
  );
const list = (w: World, query: Record<string, string> = {}, now = NOW) =>
  w.run(
    w.provide(
      listExtraSessionsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, query }),
        new Headers(),
        now
      )
    )
  );
const onExtra = (
  program:
    | typeof respondToExtraSessionRouteProgram
    | typeof withdrawExtraSessionRouteProgram
    | typeof cancelExtraSessionRouteProgram,
  w: World,
  extraId: string,
  body: unknown = {},
  now = NOW
) =>
  w.run(
    w.provide(
      program(makeContext({ params: { id: CONTRACT_ID, extraId }, body }), new Headers(), now)
    )
  );

const ok = <A>(exit: Exit.Exit<A, unknown>) => {
  if (!Exit.isSuccess(exit))
    throw new Error(`expected success, got ${JSON.stringify(failureOf(exit))}`);
  return exit.value;
};

/** A world with a proposal on file, made by `by`. */
const withProposal = async (by: User, options: Parameters<typeof makeWorld>[0] = {}) => {
  const proposer = makeWorld({ ...options, viewer: by });
  const body = by === FAMILY ? { ...SLOT, authorisedCents: 5283 } : SLOT;
  const { extraSession } = ok(await propose(proposer, body));
  return { proposer, extraId: extraSession.id };
};

/** The same in-memory state seen by another viewer. */
const asViewer = (w: World, viewer: User, grants: ReadonlyArray<Grant> = PARTY) => {
  const other = makeWorld({ viewer, grants });
  other.billing.state.sessions.splice(
    0,
    other.billing.state.sessions.length,
    ...w.billing.state.sessions
  );
  other.extras.state.extras.push(...w.extras.state.extras);
  return other;
};

describe('POST /contracts/:id/extra-sessions/quote', () => {
  it('prices the slot like a cycle: the family sees its total, the helper its share', async () => {
    const family = ok(await quote(makeWorld(), SLOT));
    expect(family.quote).toMatchObject({
      elapsedMinutes: 120,
      careCents: 5000,
      feeCents: 250,
      familyTotalCents: 5283,
      helperShareCents: null,
      authoriseCents: 5283
    });
    const helper = ok(await quote(makeWorld({ viewer: HELPER }), SLOT));
    expect(helper.quote).toMatchObject({ familyTotalCents: null, helperShareCents: 4212 });
  });

  it('refuses a slot the rules refuse, with the reason', async () => {
    const exit = await quote(makeWorld(), {
      ...SLOT,
      date: '2026-11-02',
      startMinutes: 1000,
      endMinutes: 1100
    });
    expect(failureOf(exit)).toMatchObject({ _tag: 'ExtraSessionRefusedError', reason: 'overlap' });
  });
});

describe('POST /contracts/:id/extra-sessions', () => {
  it("records the family's proposal with its authorisation and emails both sides", async () => {
    const w = makeWorld();
    const { extraSession } = ok(
      await propose(w, { ...SLOT, note: '  Mum is away ', authorisedCents: 5283 })
    );
    expect(extraSession).toMatchObject({
      status: 'proposed',
      chargeState: 'awaiting_answer',
      proposedByMe: true,
      proposedBySide: 'family',
      note: 'Mum is away',
      familyTotalCents: 5283,
      actions: ['withdraw']
    });
    expect(w.mails.map((mail) => [mail.email, mail.locale])).toEqual([
      ['family-1@example.test', 'en'],
      ['helper-1@example.test', 'fr']
    ]);
  });

  it('refuses the family without the authorisation tick (typed)', async () => {
    const exit = await propose(makeWorld(), SLOT);
    expect(failureOf(exit)).toMatchObject({ reason: 'authorisation_required' });
  });

  it('ignores an authorisation sent by the helper (the family authorises)', async () => {
    const w = makeWorld({ viewer: HELPER });
    const { extraSession } = ok(await propose(w, { ...SLOT, authorisedCents: 5283 }));
    expect(w.extras.state.extras[0]).toMatchObject({
      familyAuthorisedCents: null,
      familyAuthorisedAt: null
    });
    expect(extraSession.helperShareCents).toBeNull();
  });

  it('validates the body before anything else', async () => {
    for (const body of [
      { ...SLOT, date: '3 Nov' },
      { ...SLOT, startMinutes: -5 },
      { ...SLOT, endMinutes: 1500 },
      { ...SLOT, serviceId: '' },
      { ...SLOT, authorisedCents: 0 }
    ]) {
      expect(failureOf(await propose(makeWorld(), body))?._tag).toBe('RequestValidationError');
    }
  });

  it('is denied without the extra-session permission (403), recording nothing', async () => {
    const w = makeWorld({ grants: ['extraSession:read'] });
    expect(failureOf(await propose(w, { ...SLOT, authorisedCents: 5283 }))?._tag).toBe(
      'ForbiddenError'
    );
    expect(w.extras.state.extras).toEqual([]);
  });

  it("hides the contract from anybody who isn't one of its parties (404)", async () => {
    const w = makeWorld({ viewer: OUTSIDER });
    expect(failureOf(await propose(w, { ...SLOT, authorisedCents: 5283 }))?._tag).toBe(
      'ExtraSessionContractNotFoundError'
    );
  });
});

describe('POST /contracts/:id/extra-sessions/:extraId/respond', () => {
  it("lets the helper confirm the family's proposal: a session whose charge waits an hour", async () => {
    const { proposer, extraId } = await withProposal(FAMILY);
    const helper = asViewer(proposer, HELPER);
    const { extraSession } = ok(
      await onExtra(respondToExtraSessionRouteProgram, helper, extraId, { response: 'accept' })
    );
    expect(extraSession).toMatchObject({
      status: 'agreed',
      chargeState: 'charge_pending',
      chargeAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
      actions: ['cancel']
    });
    expect(helper.billing.state.sessions.filter((row) => row.origin === 'extra')).toHaveLength(1);
  });

  it("makes the family authorise the helper's proposal, for exactly the amount shown", async () => {
    const { proposer, extraId } = await withProposal(HELPER);
    const family = asViewer(proposer, FAMILY);
    expect(
      failureOf(
        await onExtra(respondToExtraSessionRouteProgram, family, extraId, { response: 'accept' })
      )
    ).toMatchObject({ reason: 'authorisation_required' });
    expect(
      failureOf(
        await onExtra(respondToExtraSessionRouteProgram, family, extraId, {
          response: 'accept',
          authorisedCents: 5000
        })
      )
    ).toMatchObject({ reason: 'amount_changed' });
    const { extraSession } = ok(
      await onExtra(respondToExtraSessionRouteProgram, family, extraId, {
        response: 'accept',
        authorisedCents: 5283
      })
    );
    expect(extraSession.status).toBe('agreed');
  });

  it('refuses answering your own proposal (wrong side, 403)', async () => {
    const { proposer, extraId } = await withProposal(FAMILY);
    const exit = await onExtra(respondToExtraSessionRouteProgram, proposer, extraId, {
      response: 'accept',
      authorisedCents: 5283
    });
    expect(failureOf(exit)).toMatchObject({ reason: 'wrong_side' });
  });

  it("says not found for another contract's or an unknown extra session", async () => {
    const exit = await onExtra(
      respondToExtraSessionRouteProgram,
      makeWorld({ viewer: HELPER }),
      '0198a3b0-0000-7000-8000-0000000000ff',
      { response: 'decline' }
    );
    expect(failureOf(exit)?._tag).toBe('ExtraSessionNotFoundError');
  });
});

describe('withdraw and cancel', () => {
  it('lets the proposer withdraw, and refuses the other side', async () => {
    const { proposer, extraId } = await withProposal(HELPER);
    const family = asViewer(proposer, FAMILY);
    expect(
      failureOf(await onExtra(withdrawExtraSessionRouteProgram, family, extraId))
    ).toMatchObject({
      reason: 'wrong_side'
    });
    const helper = asViewer(family, HELPER);
    expect(
      ok(await onExtra(withdrawExtraSessionRouteProgram, helper, extraId)).extraSession.status
    ).toBe('withdrawn');
  });

  it('lets either side cancel during the delay, not after', async () => {
    const { proposer, extraId } = await withProposal(FAMILY);
    const helper = asViewer(proposer, HELPER);
    ok(await onExtra(respondToExtraSessionRouteProgram, helper, extraId, { response: 'accept' }));
    const family = asViewer(helper, FAMILY);
    const late = await onExtra(
      cancelExtraSessionRouteProgram,
      family,
      extraId,
      {},
      new Date(NOW.getTime() + 61 * 60_000)
    );
    expect(failureOf(late)).toMatchObject({ reason: 'not_cancellable' });
    const { extraSession } = ok(await onExtra(cancelExtraSessionRouteProgram, family, extraId));
    expect(extraSession.status).toBe('cancelled');
  });
});

describe('GET /contracts/:id/extra-sessions', () => {
  it("lists the cycle's extra sessions with the viewer's actions and the propose dialog's facts", async () => {
    const { proposer, extraId } = await withProposal(HELPER);
    const family = asViewer(proposer, FAMILY);
    const data = ok(await list(family, { cycleId: CYCLE_ID }));
    expect(data.extraSessions).toHaveLength(1);
    expect(data.extraSessions[0]).toMatchObject({
      id: extraId,
      proposedByMe: false,
      actions: ['accept', 'decline'],
      authoriseCents: 5283,
      familyTotalCents: 5283
    });
    expect(data.propose).toMatchObject({
      canPropose: true,
      refusal: null,
      // CONTRACT_EXTRA_SESSION_LOOKBACK_DAYS back, floored at the start;
      // up to what is materialised.
      firstDate: '2026-11-02',
      lastDate: '2026-11-12',
      viewerSide: 'family',
      services: [{ serviceId: 'svc-1', name: 'Childcare', rateCents: 2500 }]
    });
    expect(data.policy).toMatchObject({
      lookbackDays: 14,
      chargeDelayMinutes: 60,
      responseHours: 48
    });
  });

  it('shows the helper its share, never the family total', async () => {
    const { proposer } = await withProposal(FAMILY);
    const helper = asViewer(proposer, HELPER);
    const [row] = ok(await list(helper)).extraSessions;
    expect(row).toMatchObject({
      familyTotalCents: null,
      helperShareCents: 4212,
      authoriseCents: null
    });
  });

  it('says why nothing can be proposed while billing is on hold, and offers nothing without write', async () => {
    const held = ok(
      await list(makeWorld({ billing: { status: 'suspended', suspendedReason: 'card' } }))
    );
    expect(held.propose).toMatchObject({ canPropose: false, refusal: 'billing_unavailable' });
    const readOnly = ok(await list(makeWorld({ grants: ['extraSession:read'] })));
    expect(readOnly.propose).toMatchObject({ canPropose: false });
  });

  it('is denied without the read permission', async () => {
    expect(failureOf(await list(makeWorld({ grants: [] })))?._tag).toBe('ForbiddenError');
  });
});

describe('error translation', () => {
  const capture = () => {
    const sent: Array<{ body: { error: { code: string } }; status: number }> = [];
    const c = {
      json: (body: { error: { code: string } }, status = 200) => {
        sent.push({ body, status });
        return sent.at(-1);
      }
    } as unknown as HonoContext<HonoEnv>;
    return { c, sent };
  };

  it.each([
    ['overlap', 'EXTRA_SESSION_OVERLAP', 409],
    ['too_far_back', 'EXTRA_SESSION_TOO_FAR_BACK', 422],
    ['authorisation_required', 'EXTRA_SESSION_AUTHORISATION_REQUIRED', 422],
    ['wrong_side', 'EXTRA_SESSION_WRONG_SIDE', 403],
    ['not_cancellable', 'EXTRA_SESSION_NOT_CANCELLABLE', 409]
  ] as const)('answers %s as %s (%i)', async (reason, code, status) => {
    const { c, sent } = capture();
    const { ExtraSessionRefusedError } = await import('@repo/billing');
    extraSessionRouteErrorToResponse(c, new ExtraSessionRefusedError({ reason }));
    expect(sent[0]).toMatchObject({ body: { error: { code } }, status });
  });

  it('answers an infrastructure failure as a 500, never a refusal', async () => {
    const { c, sent } = capture();
    const { ExtraSessionRepoError } = await import('./extra-sessions');
    extraSessionRouteErrorToResponse(c, new ExtraSessionRepoError({ cause: 'down' }));
    expect(sent[0]).toMatchObject({
      body: { error: { code: 'EXTRA_SESSION_FAILED' } },
      status: 500
    });
  });
});
