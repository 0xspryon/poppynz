import { SqlError } from '@effect/sql/SqlError';
import {
  dummyContract,
  dummyContractVersion,
  makeContractRepoTest,
  makeConversationRepoTest,
  makeServiceOfferedRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  DBNotFoundError,
  type Contract,
  type ContractServiceItem,
  type ContractVersion,
  type ContractWithContext,
  type Conversation,
  type SafeUserProfile,
  type ServiceOffered,
  type Session,
  type User,
  dummyConversation
} from '@repo/db';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  acceptContractRouteProgram,
  amendContractRouteProgram,
  contractsBadgeCountRouteProgram,
  createContractRouteProgram,
  declineContractRouteProgram,
  endContractRouteProgram,
  getContractRouteProgram,
  listContractsRouteProgram,
  markContractSeenRouteProgram,
  requestChangesRouteProgram,
  saveTermsRouteProgram,
  sendContractRouteProgram,
  withdrawContractRouteProgram
} from './contracts.handler';

const CONTRACT_ID = '0198a3b0-0000-7000-8000-00000000c001';
const CONVERSATION_ID = '0198a3b0-0000-7000-8000-000000000001';
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SERVICE_ID = '44444444-4444-4444-8444-444444444444';
const RECENT_SENT_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const EXPIRED_SENT_AT = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

const familyUser = (overrides: Partial<User> = {}): User => ({
  id: 'family-1',
  name: 'Priya K',
  email: 'priya@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'family',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides
});

const providerUser = (overrides: Partial<User> = {}): User =>
  familyUser({
    id: 'provider-1',
    name: 'Maria S',
    email: 'maria@example.com',
    role: 'service-provider',
    phoneNumber: '+1 416 555 0100',
    ...overrides
  });

const session = (userId: string): Session => ({
  id: 'session-1',
  expiresAt: new Date('2026-06-13T00:00:00.000Z'),
  token: 'token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId,
  impersonatedBy: null,
  activeOrganizationId: null
});

const profile = (
  userId: string,
  firstName: string,
  phoneNumber: string | null
): SafeUserProfile => ({
  userId,
  email: `${firstName.toLowerCase()}@example.com`,
  role: userId === 'family-1' ? 'family' : 'service-provider',
  language: 'en',
  firstName,
  lastName: 'Tester',
  gender: null,
  phoneNumber,
  dateOfBirth: null,
  address: null,
  city: 'Toronto',
  postalCode: null,
  country: null,
  stateProvince: null,
  shortBio: null,
  googlePlaceId: null,
  latitude: null,
  longitude: null
});

const offeredService = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: SERVICE_ID,
  userId: 'provider-1',
  catalogueServiceId: null,
  name: 'Childcare',
  description: null,
  hourlyRateCents: 2500,
  currency: 'CAD',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

const serviceItem = (overrides: Partial<ContractServiceItem> = {}): ContractServiceItem => ({
  serviceId: SERVICE_ID,
  name: 'Childcare',
  listedRateCents: 2500,
  rateCents: 2600,
  currency: 'CAD',
  hoursPerWeek: 4,
  expectations: 'Reading practice and a snack after school.',
  ...overrides
});

const baseContract = (overrides: Partial<Contract> = {}): Contract => ({
  ...dummyContract,
  id: CONTRACT_ID,
  conversationId: CONVERSATION_ID,
  ...overrides
});

const draftVersion = (overrides: Partial<ContractVersion> = {}): ContractVersion => ({
  ...dummyContractVersion,
  id: 'version-1',
  contractId: CONTRACT_ID,
  version: 1,
  status: 'draft',
  services: [serviceItem()],
  sentAt: null,
  decidedAt: null,
  declineReason: null,
  ...overrides
});

const proposedVersion = (overrides: Partial<ContractVersion> = {}): ContractVersion =>
  draftVersion({ status: 'proposed', sentAt: RECENT_SENT_AT, ...overrides });

const withContext = (
  contract: Contract,
  versions: Array<ContractVersion>,
  viewerUserId: string
): ContractWithContext => ({
  ...contract,
  counterpartUserId:
    viewerUserId === contract.familyUserId ? contract.providerUserId : contract.familyUserId,
  counterpartFirstName: viewerUserId === contract.familyUserId ? 'Maria' : 'Priya',
  counterpartLastName: 'Tester',
  counterpartCity: 'Toronto',
  versions
});

const activeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  ...dummyConversation,
  id: CONVERSATION_ID,
  status: 'active',
  ...overrides
});

const makeContext = (options: { body?: unknown; params?: Record<string, string> } = {}) =>
  ({
    req: {
      json: async () => options.body,
      param: (key: string) => options.params?.[key],
      query: () => undefined
    },
    get: () => 'en'
  }) as unknown as HonoContext<HonoEnv>;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

type Published = { userId: string; input: NotificationInput };

const makeLayer = (
  options: {
    viewer?: User;
    hasPermission?: boolean;
    conversationById?: Conversation | null;
    contractById?: Contract | null;
    contractWithContext?: ContractWithContext | null;
    contracts?: Array<ContractWithContext>;
    versions?: Array<ContractVersion>;
    offered?: Array<ServiceOffered>;
    createFailsWith?: SqlError;
    listForUserFailsWith?: SqlError;
    /** Per-call findByConversationId results (consumed in order). */
    findByConversationIdResults?: Array<Contract | null>;
    sendPendingResult?: ContractVersion | null;
    acceptPendingResult?: ContractVersion | null;
    decidePendingResult?: ContractVersion | null;
    withdrawPendingResult?: ContractVersion | null;
    setEndingResult?: Contract | null;
    published?: Array<Published>;
    /** Chronological record of repo mutations, for ordering assertions. */
    calls?: Array<string>;
    onCreate?: (input: unknown) => void;
    onCreateVersion?: (input: unknown) => void;
    onUpdateTerms?: (versionId: string, input: unknown) => void;
    onSetEnding?: (input: unknown) => void;
    onMarkSeen?: (contractId: string, side: string) => void;
  } = {}
) => {
  const viewer = options.viewer ?? familyUser();
  const counterpart = viewer.id === 'family-1' ? providerUser() : familyUser();
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: viewer.id }, session: { id: 'session-1' } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: (id) => {
        if (id === viewer.id) return Effect.succeed(viewer);
        if (id === counterpart.id) return Effect.succeed(counterpart);
        return Effect.fail(new DBNotFoundError({ entity: 'user', value: id }));
      },
      findByEmail: () => Effect.die('not used')
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session(viewer.id)) }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: (userId) =>
        Effect.succeed(
          userId === 'family-1'
            ? profile('family-1', 'Priya', null)
            : profile('provider-1', 'Maria', '+1 416 555 0199')
        ),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.offered ?? [offeredService()]),
      findByIdForUser: () => Effect.die('not used'),
      create: () => Effect.die('not used'),
      updateByIdForUser: () => Effect.die('not used'),
      softDeleteByIdForUser: () => Effect.die('not used')
    }),
    makeConversationRepoTest({
      create: () => Effect.die('not used'),
      findByPair: () => Effect.die('not used'),
      findById: () => Effect.succeed(options.conversationById ?? null),
      findWithContext: () => Effect.die('not used'),
      listForUser: () => Effect.die('not used'),
      listMessages: () => Effect.die('not used'),
      createMessage: () => Effect.die('not used'),
      markResponded: () => Effect.die('not used'),
      markIgnored: () => Effect.die('not used'),
      markRead: () => Effect.die('not used'),
      softDeleteById: () => Effect.die('not used')
    }),
    makeContractRepoTest({
      create: (input) => {
        options.onCreate?.(input);
        if (options.createFailsWith) return Effect.fail(options.createFailsWith);
        return Effect.succeed({
          contract: { ...baseContract(), ...input },
          version: draftVersion({ services: [] })
        });
      },
      findById: () => Effect.succeed(options.contractById ?? null),
      findByConversationId: () =>
        Effect.succeed(
          options.findByConversationIdResults && options.findByConversationIdResults.length > 0
            ? (options.findByConversationIdResults.shift() ?? null)
            : null
        ),
      findWithContext: () => Effect.succeed(options.contractWithContext ?? null),
      listForUser: () =>
        options.listForUserFailsWith
          ? Effect.fail(options.listForUserFailsWith)
          : Effect.succeed(options.contracts ?? []),
      listVersions: () => Effect.succeed(options.versions ?? []),
      createVersion: (input) => {
        options.calls?.push('createVersion');
        options.onCreateVersion?.(input);
        return Effect.succeed({
          ...draftVersion(),
          id: 'version-new',
          version: input.version,
          proposedByUserId: input.proposedByUserId,
          status: input.status,
          services: input.services,
          schedule: input.schedule,
          startsOn: input.startsOn,
          sentAt: input.sentAt ?? null
        });
      },
      updateVersionTerms: (versionId, input) => {
        options.calls?.push('updateTerms');
        options.onUpdateTerms?.(versionId, input);
        return Effect.succeed(draftVersion({ id: versionId, ...input }));
      },
      sendPendingVersion: (_contractId, versionId) => {
        options.calls?.push('sendPending');
        return Effect.succeed(
          options.sendPendingResult === undefined
            ? proposedVersion({ id: versionId, sentAt: new Date() })
            : options.sendPendingResult
        );
      },
      withdrawPendingVersion: (_contractId, versionId, restoredStatus) => {
        options.calls?.push(`withdrawPending:${restoredStatus}`);
        return Effect.succeed(
          options.withdrawPendingResult === undefined
            ? draftVersion({ id: versionId })
            : options.withdrawPendingResult
        );
      },
      withdrawAmendment: (versionId) => {
        options.calls?.push('withdrawAmendment');
        return Effect.succeed(
          proposedVersion({ id: versionId, status: 'withdrawn', decidedAt: new Date() })
        );
      },
      acceptPendingVersion: (_contractId, versionId, acceptOptions) => {
        options.calls?.push(`acceptPending:${acceptOptions.activate ? 'activate' : 'amend'}`);
        return Effect.succeed(
          options.acceptPendingResult === undefined
            ? proposedVersion({ id: versionId, status: 'accepted', decidedAt: new Date() })
            : options.acceptPendingResult
        );
      },
      decidePendingVersion: (_contractId, versionId, input) => {
        options.calls?.push(`decidePending:${input.status}:${input.contractStatus ?? 'keep'}`);
        return Effect.succeed(
          options.decidePendingResult === undefined
            ? proposedVersion({
                id: versionId,
                status: input.status,
                declineReason: input.declineReason ?? null,
                decidedAt: new Date()
              })
            : options.decidePendingResult
        );
      },
      setEnding: (contractId, input) => {
        options.calls?.push('setEnding');
        options.onSetEnding?.(input);
        if (options.setEndingResult !== undefined) return Effect.succeed(options.setEndingResult);
        return Effect.succeed(
          baseContract({
            id: contractId,
            status: 'ending',
            endsOn: input.endsOn,
            endedByUserId: input.endedByUserId,
            endNote: input.endNote,
            endNoticedAt: new Date()
          })
        );
      },
      markSeen: (contractId, side) => {
        options.onMarkSeen?.(contractId, side);
        return Effect.void;
      }
    }),
    makeNotificationHubTest({
      publish: (userId, input) => {
        options.published?.push({ userId, input });
        return Effect.void;
      },
      subscribe: () => Effect.die('not used')
    })
  );
};

describe('POST /contracts (create from conversation)', () => {
  it("creates a family-private draft from the family's active conversation, silently", async () => {
    const created: Array<any> = [];
    const published: Array<Published> = [];
    const layer = makeLayer({
      conversationById: activeConversation(),
      onCreate: (input) => created.push(input),
      published
    });

    const result = await Effect.runPromise(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID });
    expect(created).toEqual([
      { conversationId: CONVERSATION_ID, familyUserId: 'family-1', providerUserId: 'provider-1' }
    ]);
    expect(published).toEqual([]);
  });

  it('refuses the provider side of the conversation — creation is structurally family-only', async () => {
    const exit = await Effect.runPromiseExit(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ viewer: providerUser(), conversationById: activeConversation() })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractFamilyError' });
  });

  it('hides the conversation from non-participants', async () => {
    const exit = await Effect.runPromiseExit(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: familyUser({ id: 'family-2' }),
            conversationById: activeConversation()
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });

  it('requires the conversation to be unlocked', async () => {
    const exit = await Effect.runPromiseExit(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ conversationById: activeConversation({ status: 'pending' }) }))
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractConversationNotActiveError' });
  });

  it('points at the existing contract when the conversation already has one', async () => {
    const exit = await Effect.runPromiseExit(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            conversationById: activeConversation(),
            findByConversationIdResults: [baseContract()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractExistsError',
      contractId: CONTRACT_ID
    });
  });

  it("maps a lost unique-index race to CONTRACT_EXISTS with the winner's id", async () => {
    const uniqueViolation = new SqlError({
      cause: { code: '23505', constraint: 'contracts_conversation_uidx' }
    });
    const exit = await Effect.runPromiseExit(
      createContractRouteProgram(
        makeContext({ body: { conversationId: CONVERSATION_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            conversationById: activeConversation(),
            createFailsWith: uniqueViolation,
            findByConversationIdResults: [null, baseContract()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractExistsError',
      contractId: CONTRACT_ID
    });
  });
});

describe('PUT /contracts/:id/terms', () => {
  const termsBody = {
    services: [
      { serviceId: SERVICE_ID, rateCents: 2600, hoursPerWeek: 4, expectations: 'Reading practice.' }
    ],
    schedule: 'Tue & Thu 3:30–6:00 pm',
    startsOn: '2026-08-24'
  };

  it("snapshots name, listed rate and currency from the provider's listing", async () => {
    const updates: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion({ services: [] })],
      onUpdateTerms: (versionId, input) => updates.push([versionId, input])
    });

    const result = await Effect.runPromise(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, version: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0][1]).toMatchObject({
      services: [
        {
          serviceId: SERVICE_ID,
          name: 'Childcare',
          listedRateCents: 2500,
          rateCents: 2600,
          currency: 'CAD',
          hoursPerWeek: 4,
          expectations: 'Reading practice.'
        }
      ],
      schedule: 'Tue & Thu 3:30–6:00 pm',
      startsOn: '2026-08-24'
    });
  });

  it("rejects services outside the provider's current listing", async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: {
            ...termsBody,
            services: [{ ...termsBody.services[0], serviceId: OTHER_SERVICE_ID }]
          }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'UnknownContractServiceError' });
  });

  it('floors rates at the listed rate and names the offending rows', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 2000 }] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, listedRateCents: 2500 }]
    });
  });

  it('refuses the provider side', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ viewer: providerUser(), contractById: baseContract({ status: 'declined' }) })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });

  it('refuses while a sent proposal is pending — withdraw first', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses on an active contract — new terms go through an amendment', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract({ status: 'active' }) })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('rejects duplicate service line items at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [termsBody.services[0], termsBody.services[0]] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RequestValidationError',
      code: 'INVALID_CONTRACT_TERMS'
    });
  });

  it('rejects impossible calendar dates at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, startsOn: '2026-13-45' }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RequestValidationError',
      code: 'INVALID_CONTRACT_TERMS'
    });
  });

  it('starts the next version when revising after a decline', async () => {
    const createdVersions: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'declined' }),
      versions: [proposedVersion({ status: 'declined', decidedAt: new Date() })],
      onCreateVersion: (input) => createdVersions.push(input)
    });

    const result = await Effect.runPromise(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, version: 2 });
    expect(createdVersions[0]).toMatchObject({
      version: 2,
      status: 'draft',
      proposedByUserId: 'family-1'
    });
  });
});

describe('POST /contracts/:id/send', () => {
  it('proposes the draft and notifies the provider', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion()],
      published,
      calls
    });

    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(result).toMatchObject({ id: CONTRACT_ID, status: 'proposed' });
    expect(calls).toEqual(['updateTerms', 'sendPending']);
    expect(published).toEqual([
      {
        userId: 'provider-1',
        input: {
          type: 'contract.proposed',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Priya Tester', isAmendment: false }
        }
      }
    ]);
  });

  it('refuses an empty draft', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract(), versions: [draftVersion({ services: [] })] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'EmptyContractTermsError' });
  });

  it("re-checks the floor against the provider's current listing at send time", async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            // Provider raised their rate above the drafted 2600 since drafting.
            offered: [offeredService({ hourlyRateCents: 3000 })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, listedRateCents: 3000 }]
    });
  });

  it('fails without a pending draft', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses the provider side', async () => {
    // A declined contract is provider-visible; the family's revision draft is
    // not theirs to send. (A draft-only contract would 404 instead.)
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'declined' }),
            versions: [draftVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });
});

describe('POST /contracts/:id/withdraw', () => {
  it('returns a fresh proposal to draft, silently', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'proposed' }),
      versions: [proposedVersion()],
      published,
      calls
    });

    const result = await Effect.runPromise(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'draft' });
    expect(calls).toEqual(['withdrawPending:draft']);
    expect(published).toEqual([]);
  });

  it('restores the prior declined state when a revision is withdrawn', async () => {
    const calls: Array<string> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'proposed' }),
      versions: [
        proposedVersion({ id: 'version-1', version: 1, status: 'declined', decidedAt: new Date() }),
        proposedVersion({ id: 'version-2', version: 2 })
      ],
      calls
    });

    const result = await Effect.runPromise(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'declined' });
    expect(calls).toEqual(['withdrawPending:declined']);
  });

  it('refuses the provider side of a pre-active proposal', async () => {
    const exit = await Effect.runPromiseExit(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });

  it('lets the proposer retract a pending amendment, terminally and silently', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'active' }),
      versions: [
        proposedVersion({ id: 'version-1', version: 1, status: 'accepted', decidedAt: new Date() }),
        proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'provider-1' })
      ],
      published,
      calls
    });

    const result = await Effect.runPromise(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
    expect(calls).toEqual(['withdrawAmendment']);
    expect(published).toEqual([]);
  });

  it("refuses the receiver retracting the counterpart's amendment", async () => {
    const exit = await Effect.runPromiseExit(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                id: 'version-1',
                version: 1,
                status: 'accepted',
                decidedAt: new Date()
              }),
              proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'provider-1' })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });
});

describe('POST /contracts/:id/accept', () => {
  it('activates the contract and notifies the family', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      versions: [proposedVersion()],
      published,
      calls
    });

    const result = await Effect.runPromise(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
    expect(calls).toEqual(['acceptPending:activate']);
    expect(published).toEqual([
      {
        userId: 'family-1',
        input: {
          type: 'contract.accepted',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Maria Tester', isAmendment: false }
        }
      }
    ]);
  });

  it('refuses the proposer accepting their own proposal', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });

  it('refuses an expired proposal', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion({ sentAt: EXPIRED_SENT_AT })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractProposalExpiredError' });
  });

  it('fails with ContractStateError when the pending version was decided concurrently', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()],
            acceptPendingResult: null
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('hides the contract from non-participants', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: familyUser({ id: 'family-2' }),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });

  it('refuses an expired amendment like an expired proposal', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                id: 'version-1',
                version: 1,
                status: 'accepted',
                decidedAt: new Date()
              }),
              proposedVersion({
                id: 'version-2',
                version: 2,
                proposedByUserId: 'provider-1',
                sentAt: EXPIRED_SENT_AT
              })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractProposalExpiredError' });
  });

  it('supersedes the old accepted terms before accepting an amendment', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    // Provider proposed the amendment; the family accepts it.
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [
        proposedVersion({ id: 'version-1', version: 1, status: 'accepted', decidedAt: new Date() }),
        proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'provider-1' })
      ],
      published,
      calls
    });

    const result = await Effect.runPromise(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
    expect(calls).toEqual(['acceptPending:amend']);
    expect(published).toEqual([
      {
        userId: 'provider-1',
        input: {
          type: 'contract.accepted',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Priya Tester', isAmendment: true }
        }
      }
    ]);
  });
});

describe('POST /contracts/:id/decline', () => {
  it('declines with a shared reason and notifies the family', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      versions: [proposedVersion()],
      published,
      calls
    });

    const result = await Effect.runPromise(
      declineContractRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { reason: '  Schedule no longer works.  ' }
        }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'declined' });
    expect(calls).toEqual(['decidePending:declined:declined']);
    expect(published).toEqual([
      {
        userId: 'family-1',
        input: {
          type: 'contract.declined',
          payload: {
            contractId: CONTRACT_ID,
            counterpartName: 'Maria Tester',
            reason: 'Schedule no longer works.',
            isAmendment: false
          }
        }
      }
    ]);
  });

  it('still allows declining an expired proposal', async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      versions: [proposedVersion({ sentAt: EXPIRED_SENT_AT })],
      published: []
    });
    const result = await Effect.runPromise(
      declineContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ id: CONTRACT_ID, status: 'declined' });
  });

  it('leaves an active contract untouched when an amendment is declined', async () => {
    const calls: Array<string> = [];
    const published: Array<Published> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'active' }),
      versions: [
        proposedVersion({ id: 'version-1', version: 1, status: 'accepted', decidedAt: new Date() }),
        proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'family-1' })
      ],
      calls,
      published
    });

    const result = await Effect.runPromise(
      declineContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
    expect(calls).toEqual(['decidePending:declined:keep']);
    expect(published[0].input).toMatchObject({
      type: 'contract.declined',
      payload: { isAmendment: true, reason: null }
    });
  });

  it('refuses the proposer declining their own proposal', async () => {
    const exit = await Effect.runPromiseExit(
      declineContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });
});

describe('POST /contracts/:id/request-changes', () => {
  it('marks changes requested and hands back the conversation for the deep-link', async () => {
    const published: Array<Published> = [];
    const calls: Array<string> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      versions: [proposedVersion()],
      published,
      calls
    });

    const result = await Effect.runPromise(
      requestChangesRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(result).toEqual({
      id: CONTRACT_ID,
      status: 'changes_requested',
      conversationId: CONVERSATION_ID
    });
    expect(calls).toEqual(['decidePending:changes_requested:changes_requested']);
    expect(published).toEqual([
      {
        userId: 'family-1',
        input: {
          type: 'contract.changes_requested',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Maria Tester' }
        }
      }
    ]);
  });

  it('is pre-active only — amendments are accepted or declined', async () => {
    const exit = await Effect.runPromiseExit(
      requestChangesRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'active' }),
            versions: [proposedVersion({ proposedByUserId: 'family-1' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses the family side', async () => {
    const exit = await Effect.runPromiseExit(
      requestChangesRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });
});

describe('POST /contracts/:id/amendments', () => {
  const amendmentBody = {
    services: [
      { serviceId: SERVICE_ID, rateCents: 2800, hoursPerWeek: 6, expectations: 'More hours.' }
    ],
    schedule: 'Mon–Thu 3:30–6:00 pm',
    startsOn: null
  };

  it('lets the provider propose new terms on an active contract', async () => {
    const published: Array<Published> = [];
    const createdVersions: Array<any> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'active' }),
      versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })],
      published,
      onCreateVersion: (input) => createdVersions.push(input)
    });

    const result = await Effect.runPromise(
      amendContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: amendmentBody }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ id: CONTRACT_ID, version: 2 });
    expect(createdVersions[0]).toMatchObject({
      version: 2,
      status: 'proposed',
      proposedByUserId: 'provider-1'
    });
    expect(createdVersions[0].sentAt).toBeInstanceOf(Date);
    expect(published).toEqual([
      {
        userId: 'family-1',
        input: {
          type: 'contract.proposed',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Maria Tester', isAmendment: true }
        }
      }
    ]);
  });

  it("still floors a provider's own amendment at their listed rate", async () => {
    const exit = await Effect.runPromiseExit(
      amendContractRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...amendmentBody, services: [{ ...amendmentBody.services[0], rateCents: 2000 }] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'active' }),
            versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RateBelowListedError' });
  });

  it('refuses while another proposal is pending', async () => {
    const exit = await Effect.runPromiseExit(
      amendContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: amendmentBody }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                id: 'version-1',
                version: 1,
                status: 'accepted',
                decidedAt: new Date()
              }),
              proposedVersion({ id: 'version-2', version: 2 })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses on contracts that are not active', async () => {
    const exit = await Effect.runPromiseExit(
      amendContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: amendmentBody }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract({ status: 'proposed' }) })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });
});

describe('POST /contracts/:id/end', () => {
  it("gives 2 weeks' notice and notifies the counterpart with the last working day", async () => {
    const published: Array<Published> = [];
    const endInputs: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      published,
      onSetEnding: (input) => endInputs.push(input)
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { note: 'Thanks for everything!' } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    const expectedEndsOn = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(result).toEqual({ id: CONTRACT_ID, status: 'ending', endsOn: expectedEndsOn });
    expect(endInputs[0]).toEqual({
      endsOn: expectedEndsOn,
      endedByUserId: 'family-1',
      endNote: 'Thanks for everything!'
    });
    expect(published).toEqual([
      {
        userId: 'provider-1',
        input: {
          type: 'contract.ended',
          payload: {
            contractId: CONTRACT_ID,
            counterpartName: 'Priya Tester',
            endsOn: expectedEndsOn
          }
        }
      }
    ]);
  });

  it('fails when the contract is not active', async () => {
    const exit = await Effect.runPromiseExit(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract({ status: 'proposed' }), setEndingResult: null })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });
});

describe('GET /contracts/:id', () => {
  it('hides a family-private draft from the provider', async () => {
    const exit = await Effect.runPromiseExit(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractWithContext: withContext(
              baseContract({ status: 'draft' }),
              [draftVersion()],
              'provider-1'
            )
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });

  it('keeps contact details hidden pre-active and grants the receiver decision actions', async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [proposedVersion()],
        'provider-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('proposed');
    expect(contract.counterpartContact).toBeNull();
    expect(contract.pendingVersion).toMatchObject({ version: 1, proposedByMe: false });
    expect(contract.actions).toEqual({
      canEditTerms: false,
      canSend: false,
      canWithdraw: false,
      canAccept: true,
      canDecline: true,
      canRequestChanges: true,
      canAmend: false,
      canEnd: false
    });
  });

  it('presents an expired proposal as expired: decline stays, accept goes', async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [proposedVersion({ sentAt: EXPIRED_SENT_AT })],
        'provider-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('expired');
    expect(contract.actions.canAccept).toBe(false);
    expect(contract.actions.canDecline).toBe(true);
  });

  it('reveals contact details once active and offers amend/end to both sides', async () => {
    const accepted = proposedVersion({ status: 'accepted', decidedAt: new Date() });
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('active');
    expect(contract.counterpartContact).toEqual({
      email: 'maria@example.com',
      phone: '+1 416 555 0199'
    });
    expect(contract.acceptedVersion).toMatchObject({ version: 1, weeklyEstimateCents: 10400 });
    expect(contract.actions).toMatchObject({ canAmend: true, canEnd: true, canAccept: false });
  });

  it("still presents 'ending' ON the last working day — payments run through it", async () => {
    const accepted = proposedVersion({ status: 'accepted', decidedAt: new Date() });
    const today = new Date().toISOString().slice(0, 10);
    const layer = makeLayer({
      contractWithContext: withContext(
        baseContract({
          status: 'ending',
          endsOn: today,
          endedByUserId: 'family-1',
          endNoticedAt: new Date()
        }),
        [accepted],
        'family-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );
    expect(contract.status).toBe('ending');
  });

  it('presents an ending contract past its last working day as ended', async () => {
    const accepted = proposedVersion({ status: 'accepted', decidedAt: new Date() });
    const layer = makeLayer({
      contractWithContext: withContext(
        baseContract({
          status: 'ending',
          endsOn: '2026-08-01',
          endedByUserId: 'provider-1',
          endNoticedAt: new Date()
        }),
        [accepted],
        'family-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('ended');
    expect(contract.endedByMe).toBe(false);
    expect(contract.counterpartContact).not.toBeNull();
    expect(contract.actions).toMatchObject({ canAmend: false, canEnd: false });
  });
});

describe('GET /contracts + badge', () => {
  it('translates a plain repo failure into ContractRepoError (500), not an escaped SqlError', async () => {
    const exit = await Effect.runPromiseExit(
      listContractsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ listForUserFailsWith: new SqlError({ cause: new Error('boom') }) })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractRepoError' });
  });

  it("never leaks a family's unsent revision draft into the provider's list row", async () => {
    const declinedV1 = proposedVersion({
      id: 'version-1',
      version: 1,
      status: 'declined',
      decidedAt: new Date(),
      services: [serviceItem({ name: 'Childcare', rateCents: 2600, hoursPerWeek: 4 })]
    });
    const privateDraftV2 = draftVersion({
      id: 'version-2',
      version: 2,
      services: [
        serviceItem({
          serviceId: OTHER_SERVICE_ID,
          name: 'Secret new plan',
          rateCents: 5000,
          hoursPerWeek: 30
        })
      ]
    });
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(
          baseContract({ status: 'declined' }),
          [declinedV1, privateDraftV2],
          'provider-1'
        )
      ]
    });

    const result = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].serviceNames).toEqual(['Childcare']);
    expect(result.contracts[0].weeklyEstimateCents).toBe(10400);
  });

  it("lists the family's contracts with news flags and hides nothing from the owner", async () => {
    const declined = proposedVersion({
      status: 'declined',
      decidedAt: new Date(),
      declineReason: 'Schedule'
    });
    const layer = makeLayer({
      contracts: [
        withContext(baseContract({ status: 'draft' }), [draftVersion()], 'family-1'),
        withContext(
          baseContract({ id: '0198a3b0-0000-7000-8000-00000000c002', status: 'declined' }),
          [declined],
          'family-1'
        )
      ]
    });

    const result = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(result.contracts).toHaveLength(2);
    expect(result.contracts[0]).toMatchObject({
      status: 'draft',
      hasNews: false,
      awaitingYou: false
    });
    // The family proposed v1; the decline is news until they view the detail.
    expect(result.contracts[1]).toMatchObject({ status: 'declined', hasNews: true });
  });

  it("hides family-private drafts from the provider's list and counts what awaits them", async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(baseContract({ status: 'draft' }), [draftVersion()], 'provider-1'),
        withContext(
          baseContract({ id: '0198a3b0-0000-7000-8000-00000000c002', status: 'proposed' }),
          [proposedVersion()],
          'provider-1'
        )
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(list.contracts).toHaveLength(1);
    expect(list.contracts[0]).toMatchObject({
      status: 'proposed',
      awaitingYou: true,
      hasNews: true
    });

    const badge = await Effect.runPromise(
      contractsBadgeCountRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(badge).toEqual({ total: 1 });
  });

  it('clears the badge once the viewer has seen the contract', async () => {
    const seenAt = new Date(Date.now() + 60 * 1000);
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(
          baseContract({ status: 'proposed', providerSeenAt: seenAt }),
          [proposedVersion()],
          'provider-1'
        )
      ]
    });
    const badge = await Effect.runPromise(
      contractsBadgeCountRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(badge).toEqual({ total: 0 });
  });
});

describe('POST /contracts/:id/seen', () => {
  it("bumps the viewer's side marker", async () => {
    const seen: Array<[string, string]> = [];
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      onMarkSeen: (contractId, side) => seen.push([contractId, side])
    });
    const result = await Effect.runPromise(
      markContractSeenRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual([[CONTRACT_ID, 'provider']]);
  });

  it('hides the contract from non-participants', async () => {
    const exit = await Effect.runPromiseExit(
      markContractSeenRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: familyUser({ id: 'family-2' }),
            contractById: baseContract({ status: 'proposed' })
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });
});

describe('authorization', () => {
  const denied = () => makeLayer({ hasPermission: false });
  const cases: Array<[string, () => Effect.Effect<unknown, unknown, any>]> = [
    [
      'create',
      () =>
        createContractRouteProgram(
          makeContext({ body: { conversationId: CONVERSATION_ID } }),
          new Headers()
        )
    ],
    ['list', () => listContractsRouteProgram(new Headers())],
    ['badge', () => contractsBadgeCountRouteProgram(new Headers())],
    [
      'detail',
      () => getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'terms',
      () =>
        saveTermsRouteProgram(
          makeContext({ params: { id: CONTRACT_ID }, body: { services: [] } }),
          new Headers()
        )
    ],
    [
      'send',
      () => sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'withdraw',
      () =>
        withdrawContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'accept',
      () => acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'decline',
      () =>
        declineContractRouteProgram(
          makeContext({ params: { id: CONTRACT_ID }, body: {} }),
          new Headers()
        )
    ],
    [
      'request-changes',
      () => requestChangesRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'amend',
      () =>
        amendContractRouteProgram(
          makeContext({ params: { id: CONTRACT_ID }, body: { services: [] } }),
          new Headers()
        )
    ],
    [
      'end',
      () =>
        endContractRouteProgram(
          makeContext({ params: { id: CONTRACT_ID }, body: {} }),
          new Headers()
        )
    ],
    [
      'seen',
      () =>
        markContractSeenRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ]
  ];

  it.each(cases)(
    'fails %s with ForbiddenError when the contract permission is missing',
    async (_name, program) => {
      const exit = await Effect.runPromiseExit(program().pipe(Effect.provide(denied())));
      expect(getFailure(exit)).toMatchObject({ _tag: 'ForbiddenError' });
    }
  );
});
