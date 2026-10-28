import { SqlError } from '@effect/sql/SqlError';
import {
  ContractRepo,
  ContractReplacementRepo,
  ConversationRepo,
  DBNotFoundError,
  SessionResolutionRepo,
  dummyContract,
  dummyContractBilling,
  dummyContractVersion,
  dummySessionResolution,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionResolutionRepo,
  makeServiceOfferedRepoTest,
  makeUserProfileRepoTest,
  type Contract,
  type ContractReplacementLink,
  type Conversation,
  type PublishableService,
  type ReplacementDraftInput,
  type ServiceOffered
} from '@repo/db';
import { Context, Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import type { UserAndSession } from '@/api/lib/effect-auth';
import {
  createReplacementProgram,
  matchingService,
  parseSessionIdsQuery,
  replacementContextProgram,
  replacementRateCents,
  replacementSchedule
} from './replacement';
import {
  CONTRACT_ID,
  CONVERSATION_ID,
  CYCLE_ID,
  TORONTO,
  failureOf,
  session
} from './sessions.test-support';

// ---------------------------------------------------------------------------
// World: Priya's contract with Maria (helper-1). Maria cancelled two Tuesday
// sessions; Priya cancelled a Thursday one herself; one Tuesday is past.

const NOW = new Date('2026-10-30T12:00:00.000Z');
const S1 = '0198a3b0-0000-7000-8000-00000000ee01'; // Tue 3 Nov 15:30–17:30, helper cancelled
const S2 = '0198a3b0-0000-7000-8000-00000000ee02'; // Tue 10 Nov 15:30–17:30, helper day off agreed
const S3 = '0198a3b0-0000-7000-8000-00000000ee03'; // Thu 5 Nov, family cancelled
const S4 = '0198a3b0-0000-7000-8000-00000000ee04'; // Tue 27 Oct (past), helper cancelled
const S5 = '0198a3b0-0000-7000-8000-00000000ee05'; // Wed 4 Nov, pet care, helper cancelled
const NEW_CONVERSATION = '0198a3b0-0000-7000-8000-000000000002';

const family: UserAndSession = {
  user: { id: 'family-1', name: 'Priya', role: 'family' } as UserAndSession['user'],
  session: { id: 'session-1' } as UserAndSession['session']
};
const helperViewer: UserAndSession = {
  user: { id: 'helper-1', name: 'Maria', role: 'service-provider' } as UserAndSession['user'],
  session: { id: 'session-2' } as UserAndSession['session']
};

const offered = (overrides: Partial<PublishableService> = {}): PublishableService => ({
  id: 'svc-new',
  userId: 'helper-2',
  catalogueServiceId: 'cat-childcare',
  catalogueBaseRateCents: 2200,
  name: 'Child care',
  description: null,
  hourlyRateCents: 3000,
  currency: 'CAD',
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
  deletedAt: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  ...overrides
});

const conversationWith = (
  providerUserId: string,
  status: Conversation['status'] = 'active'
): Conversation =>
  ({
    id: NEW_CONVERSATION,
    familyUserId: 'family-1',
    providerUserId,
    status
  }) as Conversation;

type WorldOptions = {
  /** helper-2's live listing (all of it) and which of it is publishable. */
  listed?: Array<PublishableService>;
  publishable?: Array<PublishableService>;
  conversation?: Conversation | null;
  /** Contracts already in the new conversation. */
  existing?: Array<Contract>;
  links?: Map<string, ContractReplacementLink>;
  /** The draft insert loses a race to this contract (SQLSTATE 23505). */
  raceWinner?: { contract: Contract; link: ContractReplacementLink | null };
};

const makeWorld = (options: WorldOptions = {}) => {
  const billing = makeInMemoryContractBillingRepo({
    billing: [
      dummyContractBilling({
        contractId: CONTRACT_ID,
        acceptedVersionId: 'version-1',
        timeZone: TORONTO,
        status: 'active'
      })
    ]
  });
  billing.state.sessions.push(
    session({ id: S1 }),
    session({
      id: S2,
      date: '2026-11-10',
      startsAt: new Date('2026-11-10T20:30:00.000Z'),
      endsAt: new Date('2026-11-10T22:30:00.000Z')
    }),
    session({
      id: S3,
      date: '2026-11-05',
      startsAt: new Date('2026-11-05T20:30:00.000Z'),
      endsAt: new Date('2026-11-05T22:30:00.000Z')
    }),
    session({
      id: S4,
      date: '2026-10-27',
      startsAt: new Date('2026-10-27T19:30:00.000Z'),
      endsAt: new Date('2026-10-27T21:30:00.000Z')
    }),
    session({
      id: S5,
      date: '2026-11-04',
      serviceId: 'svc-pets',
      serviceName: 'Pet care',
      startsAt: new Date('2026-11-04T20:30:00.000Z'),
      endsAt: new Date('2026-11-04T22:30:00.000Z')
    })
  );
  const resolution = (id: string, sessionId: string, overrides = {}) =>
    dummySessionResolution({
      id,
      contractId: CONTRACT_ID,
      cycleId: CYCLE_ID,
      sessionId,
      kind: 'helper_cancelled',
      reportedByUserId: 'helper-1',
      reportedBySide: 'helper',
      status: 'confirmed',
      ...overrides
    });
  const resolutions = makeInMemorySessionResolutionRepo({
    resolutions: [
      resolution('r1', S1),
      resolution('r2', S2, { kind: 'day_off_agreed', response: 'accepted' }),
      resolution('r3', S3, {
        kind: 'family_cancelled_early',
        reportedByUserId: 'family-1',
        reportedBySide: 'family'
      }),
      resolution('r4', S4),
      resolution('r5', S5)
    ]
  });

  const original = {
    ...dummyContract,
    id: CONTRACT_ID,
    conversationId: CONVERSATION_ID,
    familyUserId: 'family-1',
    providerUserId: 'helper-1',
    status: 'active' as const
  };
  const accepted = {
    ...dummyContractVersion,
    id: 'version-1',
    contractId: CONTRACT_ID,
    status: 'accepted' as const,
    services: [
      {
        ...dummyContractVersion.services[0]!,
        serviceId: 'svc-1',
        expectations: 'Pick up from school, then homework.'
      }
    ]
  };
  const contracts: Array<Contract> = [...(options.existing ?? [])];
  const links = options.links ?? new Map<string, ContractReplacementLink>();
  const drafts: Array<ReplacementDraftInput> = [];
  let raced = false;

  const listed = options.listed ?? [offered()];
  const publishable = options.publishable ?? listed;
  const conversation =
    options.conversation === undefined ? conversationWith('helper-2') : options.conversation;

  const layer = Layer.mergeAll(
    billing.layer,
    Layer.succeed(
      SessionResolutionRepo,
      resolutions.service as Context.Tag.Service<typeof SessionResolutionRepo>
    ),
    Layer.succeed(ContractRepo, {
      findById: (id: string) =>
        Effect.succeed(
          id === CONTRACT_ID ? original : (contracts.find((c) => c.id === id) ?? null)
        ),
      findWithContext: () =>
        Effect.succeed({
          ...original,
          counterpartUserId: 'helper-1',
          counterpartFirstName: 'Maria',
          counterpartLastName: 'Tremblay',
          counterpartCity: 'Ottawa',
          versions: [accepted]
        }),
      listByConversationId: (conversationId: string) =>
        Effect.succeed(contracts.filter((row) => row.conversationId === conversationId)),
      listVersions: () => Effect.succeed([accepted])
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    Layer.succeed(ConversationRepo, {
      findByPair: (familyUserId: string, providerUserId: string) =>
        Effect.succeed(
          conversation &&
            conversation.familyUserId === familyUserId &&
            conversation.providerUserId === providerUserId
            ? conversation
            : null
        )
    } as unknown as Context.Tag.Service<typeof ConversationRepo>),
    makeServiceOfferedRepoTest({
      listByUserId: (userId) => Effect.succeed(userId === 'helper-2' ? listed : []),
      listPublishableByUserIds: (userIds) =>
        Effect.succeed(userIds.includes('helper-2') ? publishable : []),
      findByIdForUser: (id, userId) =>
        id === 'svc-1' && userId === 'helper-1'
          ? Effect.succeed(
              offered({ id: 'svc-1', userId: 'helper-1', name: 'Childcare' }) as ServiceOffered
            )
          : Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      create: () => Effect.die('unused'),
      updateByIdForUser: () => Effect.die('unused'),
      softDeleteByIdForUser: () => Effect.die('unused')
    }),
    Layer.succeed(ContractReplacementRepo, {
      createDraft: (input: ReplacementDraftInput) => {
        if (options.raceWinner && !raced) {
          raced = true;
          contracts.push(options.raceWinner.contract);
          if (options.raceWinner.link) {
            links.set(options.raceWinner.contract.id, options.raceWinner.link);
          }
          return Effect.fail(new SqlError({ cause: { code: '23505' } }));
        }
        drafts.push(input);
        const contract = {
          ...dummyContract,
          id: `replacement-${drafts.length}`,
          conversationId: input.conversationId,
          familyUserId: input.familyUserId,
          providerUserId: input.providerUserId,
          status: 'draft' as const
        };
        contracts.push(contract);
        links.set(contract.id, {
          replacesContractId: input.replacesContractId,
          sessionIds: [...input.sessionIds].sort()
        });
        return Effect.succeed({ contract, version: dummyContractVersion });
      },
      findForContract: (contractId: string) => Effect.succeed(links.get(contractId) ?? null),
      listByReplacedContract: (replacesContractId: string) =>
        Effect.succeed(
          [...links.entries()].flatMap(([contractId, link]) =>
            link.replacesContractId === replacesContractId
              ? link.sessionIds.map((sessionId) => ({ contractId, sessionId }))
              : []
          )
        )
    } as Context.Tag.Service<typeof ContractReplacementRepo>),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: () => Effect.die('unused'),
      updateByUserId: () => Effect.die('unused'),
      updateLocationByUserId: () => Effect.die('unused')
    })
  );
  return { layer, drafts, contracts, links };
};

type World = ReturnType<typeof makeWorld>;

const create = (
  world: World,
  input: { providerUserId: string; sessionIds: Array<string> },
  viewer: UserAndSession = family
) =>
  Effect.runPromiseExit(
    createReplacementProgram(viewer, CONTRACT_ID, input, NOW).pipe(Effect.provide(world.layer))
  );

const valueOf = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) {
    throw new Error(`expected success, got ${JSON.stringify(failureOf(exit))}`);
  }
  return exit.value;
};

// ---------------------------------------------------------------------------

describe('replacementSchedule', () => {
  it('turns the cancelled sessions into a short weekly pattern between the first and last date', () => {
    expect(
      replacementSchedule([
        { date: '2026-11-10', startMinutes: 930, endMinutes: 1050 },
        { date: '2026-11-03', startMinutes: 930, endMinutes: 1050 },
        { date: '2026-11-05', startMinutes: 600, endMinutes: 720 }
      ])
    ).toEqual({
      sessions: [
        { weekday: 1, startMinutes: 930, endMinutes: 1050 },
        { weekday: 3, startMinutes: 600, endMinutes: 720 }
      ],
      startsOn: '2026-11-03',
      endsOn: '2026-11-10',
      endsAtMinutes: null
    });
  });

  it('cuts the last day at its last cancelled session when the pattern runs later that weekday', () => {
    // Tuesdays: the afternoon on the 3rd, only the morning on the 10th.
    expect(
      replacementSchedule([
        { date: '2026-11-03', startMinutes: 930, endMinutes: 1050 },
        { date: '2026-11-10', startMinutes: 540, endMinutes: 660 }
      ])
    ).toMatchObject({ startsOn: '2026-11-03', endsOn: '2026-11-10', endsAtMinutes: 660 });
  });
});

describe('matchingService / replacementRateCents', () => {
  it('matches the same catalogue service first, else the same name', () => {
    const byCatalogue = offered({ id: 'a', name: 'Garde', catalogueServiceId: 'cat-childcare' });
    const byName = offered({ id: 'b', name: ' childcare ', catalogueServiceId: null });
    expect(
      matchingService([byName, byCatalogue], {
        catalogueServiceId: 'cat-childcare',
        name: 'Childcare'
      })?.id
    ).toBe('a');
    expect(matchingService([byName], { catalogueServiceId: null, name: 'Childcare' })?.id).toBe(
      'b'
    );
    expect(matchingService([byName], { catalogueServiceId: null, name: 'Pet care' })).toBeNull();
  });

  it("prices at the new helper's listed rate, never below the offer floor", () => {
    expect(
      replacementRateCents(offered({ hourlyRateCents: 3000, catalogueBaseRateCents: 2200 }))
    ).toBe(3000);
    // A listing below today's base rate keeps its listed rate: the offer
    // floor is the base rate capped at what the helper lists (UAT #39).
    expect(
      replacementRateCents(offered({ hourlyRateCents: 1800, catalogueBaseRateCents: 2200 }))
    ).toBe(1800);
  });
});

describe('parseSessionIdsQuery', () => {
  it('reads a comma-separated list, or nothing for every session', async () => {
    expect(await Effect.runPromise(parseSessionIdsQuery(undefined))).toBeNull();
    expect(await Effect.runPromise(parseSessionIdsQuery(` ${S1}, ${S2} `))).toEqual([S1, S2]);
    const bad = await Effect.runPromiseExit(parseSessionIdsQuery('not-a-uuid'));
    expect(failureOf(bad)?._tag).toBe('RequestValidationError');
  });
});

describe('replacementContextProgram (GET /contracts/:id/replacement)', () => {
  it("lists the helper's upcoming cancellations with the helper to leave out of the search", async () => {
    const world = makeWorld({
      links: new Map([['earlier', { replacesContractId: CONTRACT_ID, sessionIds: [S2] }]])
    });
    const { replacement } = await Effect.runPromise(
      replacementContextProgram(family, CONTRACT_ID, null, NOW).pipe(Effect.provide(world.layer))
    );
    expect(replacement.helper).toEqual({ userId: 'helper-1', name: 'Maria Tremblay' });
    // Not the family's own cancellation (S3), not the past one (S4).
    expect(replacement.sessions.map((row) => [row.id, row.replacementContractId])).toEqual([
      [S1, null],
      [S5, null],
      [S2, 'earlier']
    ]);
  });

  it('narrows to the named sessions and refuses one the helper did not cancel', async () => {
    const world = makeWorld();
    const named = await Effect.runPromise(
      replacementContextProgram(family, CONTRACT_ID, [S2], NOW).pipe(Effect.provide(world.layer))
    );
    expect(named.replacement.sessions.map((row) => row.id)).toEqual([S2]);
    const exit = await Effect.runPromiseExit(
      replacementContextProgram(family, CONTRACT_ID, [S3], NOW).pipe(Effect.provide(world.layer))
    );
    expect(failureOf(exit)).toMatchObject({
      _tag: 'ReplacementSessionsInvalidError',
      reason: 'not_cancelled_by_helper'
    });
  });

  it('is for the family only', async () => {
    const exit = await Effect.runPromiseExit(
      replacementContextProgram(helperViewer, CONTRACT_ID, null, NOW).pipe(
        Effect.provide(makeWorld().layer)
      )
    );
    expect(failureOf(exit)?._tag).toBe('NotContractActorError');
  });
});

describe('createReplacementProgram (POST /contracts/:id/replacement)', () => {
  it('creates a short draft with the new helper, pre-filled from the original contract', async () => {
    const world = makeWorld();
    const result = valueOf(
      await create(world, { providerUserId: 'helper-2', sessionIds: [S2, S1] })
    );
    expect(result).toEqual({ id: 'replacement-1', reused: false });
    expect(world.drafts).toHaveLength(1);
    expect(world.drafts[0]).toEqual({
      conversationId: NEW_CONVERSATION,
      familyUserId: 'family-1',
      providerUserId: 'helper-2',
      services: [
        {
          serviceId: 'svc-new',
          name: 'Child care',
          listedRateCents: 3000,
          rateCents: 3000,
          currency: 'CAD',
          sessions: [{ weekday: 1, startMinutes: 930, endMinutes: 1050 }],
          expectations: 'Pick up from school, then homework.'
        }
      ],
      startsOn: '2026-11-03',
      endsOn: '2026-11-10',
      endsAtMinutes: null,
      replacesContractId: CONTRACT_ID,
      sessionIds: [S1, S2]
    });
  });

  it('refuses the helper who cancelled', async () => {
    const world = makeWorld({ conversation: conversationWith('helper-1') });
    const exit = await create(world, { providerUserId: 'helper-1', sessionIds: [S1] });
    expect(failureOf(exit)?._tag).toBe('ReplacementSameHelperError');
    expect(world.drafts).toHaveLength(0);
  });

  it("refuses a helper who doesn't offer the service", async () => {
    const world = makeWorld({
      listed: [offered({ name: 'Pet care', catalogueServiceId: 'cat-pets' })]
    });
    const exit = await create(world, { providerUserId: 'helper-2', sessionIds: [S1] });
    expect(failureOf(exit)?._tag).toBe('ReplacementServiceNotOfferedError');
  });

  it("refuses a helper whose listing for the service isn't publishable", async () => {
    const world = makeWorld({
      listed: [offered({ catalogueServiceId: null, name: 'Childcare', reviewStatus: 'pending' })],
      publishable: []
    });
    const exit = await create(world, { providerUserId: 'helper-2', sessionIds: [S1] });
    expect(failureOf(exit)?._tag).toBe('ReplacementServiceNotPublishableError');
  });

  it('sends the family through the reach-out without a conversation, or while it is pending', async () => {
    const none = await create(makeWorld({ conversation: null }), {
      providerUserId: 'helper-2',
      sessionIds: [S1]
    });
    expect(failureOf(none)).toMatchObject({
      _tag: 'ReplacementReachOutRequiredError',
      status: 'none',
      conversationId: null
    });
    const pending = await create(
      makeWorld({ conversation: conversationWith('helper-2', 'pending') }),
      { providerUserId: 'helper-2', sessionIds: [S1] }
    );
    expect(failureOf(pending)).toMatchObject({
      _tag: 'ReplacementReachOutRequiredError',
      status: 'pending',
      conversationId: NEW_CONVERSATION
    });
  });

  it("prices at the new helper's listed rate (floored), not the original rate", async () => {
    const world = makeWorld({ listed: [offered({ hourlyRateCents: 2100 })] });
    valueOf(await create(world, { providerUserId: 'helper-2', sessionIds: [S1] }));
    expect(world.drafts[0]?.services[0]).toMatchObject({ listedRateCents: 2100, rateCents: 2100 });
  });

  it('returns the same draft when asked twice (double click)', async () => {
    const world = makeWorld();
    const first = valueOf(
      await create(world, { providerUserId: 'helper-2', sessionIds: [S1, S2] })
    );
    const second = valueOf(
      await create(world, { providerUserId: 'helper-2', sessionIds: [S2, S1, S1] })
    );
    expect(second).toEqual({ id: first.id, reused: true });
    expect(world.drafts).toHaveLength(1);
  });

  it('returns the winning draft when a concurrent click wins the insert race', async () => {
    const winner = {
      ...dummyContract,
      id: 'winner',
      conversationId: NEW_CONVERSATION,
      status: 'draft' as const
    };
    const world = makeWorld({
      raceWinner: {
        contract: winner,
        link: { replacesContractId: CONTRACT_ID, sessionIds: [S1] }
      }
    });
    const result = valueOf(await create(world, { providerUserId: 'helper-2', sessionIds: [S1] }));
    expect(result).toEqual({ id: 'winner', reused: true });
  });

  it('points at another contract being negotiated in that conversation (CONTRACT_EXISTS)', async () => {
    const world = makeWorld({
      existing: [
        { ...dummyContract, id: 'other', conversationId: NEW_CONVERSATION, status: 'proposed' }
      ]
    });
    const exit = await create(world, { providerUserId: 'helper-2', sessionIds: [S1] });
    expect(failureOf(exit)).toMatchObject({ _tag: 'ContractExistsError', contractId: 'other' });
  });

  it('refuses sessions the helper did not cancel, past ones and mixed services', async () => {
    const world = makeWorld();
    const cases: Array<[Array<string>, string]> = [
      [[S3], 'not_cancelled_by_helper'],
      [[S4], 'already_started'],
      [[S1, S5], 'mixed_services'],
      [['0198a3b0-0000-7000-8000-00000000ffff'], 'unknown_session']
    ];
    for (const [sessionIds, reason] of cases) {
      const exit = await create(world, { providerUserId: 'helper-2', sessionIds });
      expect(failureOf(exit)).toMatchObject({ _tag: 'ReplacementSessionsInvalidError', reason });
    }
    expect(world.drafts).toHaveLength(0);
  });

  it('is for the family only', async () => {
    const exit = await create(
      makeWorld(),
      { providerUserId: 'helper-2', sessionIds: [S1] },
      helperViewer
    );
    expect(failureOf(exit)?._tag).toBe('NotContractActorError');
  });
});
