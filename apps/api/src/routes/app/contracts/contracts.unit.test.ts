import { SqlError } from '@effect/sql/SqlError';
import {
  dummyContract,
  dummyContractVersion,
  makeApprovalRepoTest,
  makeContractRepoTest,
  makeConversationRepoTest,
  makeServiceOfferedRepoTest,
  makeSafetyVerificationRepoTest,
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
import { addDays, todayIn } from '@repo/calendar';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  acceptContractRouteProgram,
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

const WPG = 'America/Winnipeg';

/** Pins `new Date()` / `Date.now()` only — Effect's scheduler keeps real timers. */
const freezeNow = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};
afterEach(() => {
  vi.useRealTimers();
});

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
  phoneNumber: string | null,
  location: { latitude: number; longitude: number } | null = null
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
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null
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

// Tue & Thu 3:30-5:30 pm local wall-clock = 4 derived hrs/wk.
const twoWeekdaySessions = [
  { weekday: 1, startMinutes: 930, endMinutes: 1050 },
  { weekday: 3, startMinutes: 930, endMinutes: 1050 }
];

const serviceItem = (overrides: Partial<ContractServiceItem> = {}): ContractServiceItem => ({
  serviceId: SERVICE_ID,
  name: 'Childcare',
  listedRateCents: 2500,
  rateCents: 2600,
  currency: 'CAD',
  sessions: twoWeekdaySessions,
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
  startsOn: '2099-01-05',
  ...overrides
});

const proposedVersion = (overrides: Partial<ContractVersion> = {}): ContractVersion =>
  draftVersion({ status: 'proposed', sentAt: RECENT_SENT_AT, timeZone: WPG, ...overrides });

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
    onSendPending?: (versionId: string, terms: unknown) => void;
    onSetEnding?: (input: unknown) => void;
    onMarkSeen?: (contractId: string, side: string) => void;
    familyApproved?: boolean;
    providerApproved?: boolean;
    /** The family's saved coordinates; null = no address yet. Defaults to Winnipeg. */
    familyLocation?: { latitude: number; longitude: number } | null;
  } = {}
) => {
  const viewer = options.viewer ?? familyUser();
  const counterpart = viewer.id === 'family-1' ? providerUser() : familyUser();
  return Layer.mergeAll(
    // Safety verification now gates the bookable actions; these suites assert
    // other behaviour, so the applicant is verified unless a test says so.
    makeSafetyVerificationRepoTest({
      findLive: () =>
        Effect.succeed({ id: 'sv-1', status: 'verified', expiresOn: '2099-01-01' } as never),
      findById: () => Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () =>
        Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listLapsed: () => Effect.succeed([])
    }),
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
            ? profile(
                'family-1',
                'Priya',
                null,
                options.familyLocation === undefined
                  ? { latitude: 49.8951, longitude: -97.1384 }
                  : options.familyLocation
              )
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
    makeApprovalRepoTest({
      findCurrentByUserId: (userId) => {
        const approved =
          userId === familyUser().id
            ? (options.familyApproved ?? true)
            : (options.providerApproved ?? true);
        return approved
          ? Effect.succeed({
              id: `approval-${userId}`,
              userId,
              status: 'approved',
              expiresAt: new Date('2099-01-01')
            } as never)
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }));
      }
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
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          sentAt: input.sentAt ?? null
        });
      },
      updateVersionTerms: (versionId, input) => {
        options.calls?.push('updateTerms');
        options.onUpdateTerms?.(versionId, input);
        return Effect.succeed(draftVersion({ id: versionId, ...input }));
      },
      sendPendingVersion: (_contractId, versionId, terms) => {
        options.calls?.push('sendPending');
        options.onSendPending?.(versionId, terms);
        return Effect.succeed(
          options.sendPendingResult === undefined
            ? proposedVersion({ id: versionId, ...terms, sentAt: new Date() })
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
      {
        serviceId: SERVICE_ID,
        rateCents: 2600,
        sessions: twoWeekdaySessions,
        expectations: 'Reading practice.'
      }
    ],
    startsOn: '2026-08-24',
    endsOn: null
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
          sessions: twoWeekdaySessions,
          expectations: 'Reading practice.'
        }
      ],
      startsOn: '2026-08-24',
      endsOn: null
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

  it('floors rates at half the listed rate and names the offending rows', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 1249 }] }
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

  it('accepts a rate at exactly half the listed rate', async () => {
    const updates: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion()],
      onUpdateTerms: (versionId, input) => updates.push([versionId, input])
    });
    const result = await Effect.runPromise(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 1250 }] }
        }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ id: CONTRACT_ID, version: 1 });
    expect(updates[0][1]).toMatchObject({
      services: [{ serviceId: SERVICE_ID, listedRateCents: 2500, rateCents: 1250 }]
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

  it('refuses on an active contract — signed terms are never edited', async () => {
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

  it('rejects a service without sessions at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], sessions: [] }] }
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

  it.each([
    ['out of range', { endsOn: '2026-09-30', endsAtMinutes: 0 }],
    ['not whole minutes', { endsOn: '2026-09-30', endsAtMinutes: 12.5 }],
    ['without an end date', { endsOn: null, endsAtMinutes: 720 }]
  ])('describes a bad last-day end time (%s) in the error message', async (_label, dates) => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { ...termsBody, ...dates } }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    const failure = getFailure(exit);
    expect(failure).toMatchObject({
      _tag: 'RequestValidationError',
      code: 'INVALID_CONTRACT_TERMS'
    });
    expect((failure as { message: string }).message).toMatch(/end time/i);
  });

  it('keeps the services message for a services problem', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], sessions: [] }] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({
      message: 'Each service needs a valid rate and at least one weekly session.'
    });
  });

  it('rejects an end date before the start date at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, startsOn: '2026-08-24', endsOn: '2026-08-23' }
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

  it('saves a last-day end time with the end date', async () => {
    const updates: Array<unknown> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion()],
      onUpdateTerms: (_versionId, input) => updates.push(input)
    });

    await Effect.runPromise(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, endsOn: '2026-12-11', endsAtMinutes: 720 }
        }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(updates[0]).toMatchObject({ endsOn: '2026-12-11', endsAtMinutes: 720 });
    expect(updates[0]).not.toHaveProperty('timeZone');
  });

  it('rejects an end time without an end date at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { ...termsBody, endsAtMinutes: 720 } }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
  });

  it('rejects an end time outside 1..1440 at validation', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, endsOn: '2026-12-11', endsAtMinutes: 0 }
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
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
    // Terms, zone and status flip go in one guarded write — no separate
    // terms update a concurrent draft save could race.
    expect(calls).toEqual(['sendPending']);
    expect(published).toEqual([
      {
        userId: 'provider-1',
        input: {
          type: 'contract.proposed',
          payload: { contractId: CONTRACT_ID, counterpartName: 'Priya Tester' }
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
            // Provider raised their rate enough that the drafted 2600 is now
            // below the half-the-listing floor (ceil(6000 / 2) = 3000).
            offered: [offeredService({ hourlyRateCents: 6000 })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, listedRateCents: 6000 }]
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

  it("stamps the family's time zone on the version it sends", async () => {
    const updates: Array<unknown> = [];
    const layer = makeLayer({
      contractById: baseContract(),
      versions: [draftVersion({ endsOn: '2099-03-01', endsAtMinutes: 720 })],
      // Listing moved since the draft; the refreshed snapshot is what is sent.
      offered: [offeredService({ hourlyRateCents: 2700 })],
      onSendPending: (_versionId, terms) => updates.push(terms)
    });

    await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      timeZone: WPG,
      startsOn: '2099-01-05',
      endsOn: '2099-03-01',
      endsAtMinutes: 720,
      services: [{ serviceId: SERVICE_ID, rateCents: 2600, listedRateCents: 2700 }]
    });
  });

  it('refuses to send without a start date', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract(), versions: [draftVersion({ startsOn: null })] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateRequiredError', action: 'send' });
  });

  it('refuses to send while the family has no saved location', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            familyLocation: null
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'FamilyLocationRequiredError' });
  });

  it("refuses a start date that is today in the family's zone", async () => {
    freezeNow('2026-09-10T05:30:00Z'); // Sep 10, 00:30 in Winnipeg
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateNotInFutureError' });
  });

  it("allows tomorrow in the family's zone even when UTC is already there", async () => {
    freezeNow('2026-09-10T04:30:00Z'); // still Sep 9, 23:30 in Winnipeg
    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'proposed' });
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
          payload: { contractId: CONTRACT_ID, counterpartName: 'Maria Tester' }
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

  it('refuses accepting on an active contract — signed contracts are never amended', async () => {
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
              proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'provider-1' })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses accepting on the start date in the contract zone', async () => {
    freezeNow('2026-09-10T05:30:00Z'); // Sep 10, 00:30 in Winnipeg
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [
              proposedVersion({ startsOn: '2026-09-10', sentAt: new Date('2026-09-08T12:00:00Z') })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStartDatePassedError' });
  });

  it('refuses a sent version without a start date as START_DATE_REQUIRED, not "passed"', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion({ startsOn: null })]
          })
        )
      )
    );
    // The accept-side copy is addressed to the provider, not the sender.
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateRequiredError', action: 'accept' });
  });

  it('allows accepting the evening before, although UTC is already on the start date', async () => {
    freezeNow('2026-09-10T04:30:00Z'); // Sep 9, 23:30 in Winnipeg
    const result = await Effect.runPromise(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [
              proposedVersion({ startsOn: '2026-09-10', sentAt: new Date('2026-09-08T12:00:00Z') })
            ]
          })
        )
      )
    );
    expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
  });
});

describe('contract approval gates', () => {
  it('blocks sending terms to a provider without a live approval', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            providerApproved: false
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'CounterpartNotApprovedError' });
  });

  it('blocks a family without a live approval from sending terms', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            familyApproved: false
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ApprovalRequiredError', role: 'family' });
  });

  it('blocks accepting terms proposed by a family that lost its approval', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()],
            familyApproved: false
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'CounterpartNotApprovedError' });
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
            reason: 'Schedule no longer works.'
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

  it('refuses declining on an active contract — signed contracts are never amended', async () => {
    const exit = await Effect.runPromiseExit(
      declineContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                id: 'version-1',
                version: 1,
                status: 'accepted',
                decidedAt: new Date()
              }),
              proposedVersion({ id: 'version-2', version: 2, proposedByUserId: 'family-1' })
            ]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
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

  it('is pre-active only — it steers the negotiation back to chat', async () => {
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

describe('POST /contracts/:id/end', () => {
  it("gives 2 weeks' notice and notifies the counterpart with the last working day", async () => {
    const published: Array<Published> = [];
    const endInputs: Array<any> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })],
      published,
      onSetEnding: (input) => endInputs.push(input)
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { note: 'Thanks for everything!' } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    // The notice date's calendar day in the contract zone, plus 14 days.
    const expectedEndsOn = addDays(todayIn(WPG), 14);
    expect(result).toEqual({
      id: CONTRACT_ID,
      status: 'ending',
      endsOn: expectedEndsOn,
      endsAtMinutes: null
    });
    expect(endInputs[0]).toEqual({
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
            endsOn: expectedEndsOn,
            endsAtMinutes: null
          }
        }
      }
    ]);
  });

  it('counts the notice in calendar days in the contract zone, across a DST change', async () => {
    // 04:00Z on Oct 25 is still Oct 24 (23:00 CDT) in Winnipeg; +14 days
    // crosses the Nov 1 fall-back and lands on Nov 7.
    freezeNow('2026-10-25T04:00:00Z');
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [proposedVersion({ status: 'accepted', decidedAt: new Date() })]
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toMatchObject({ endsOn: '2026-11-07' });
  });

  it('gives the earlier negotiated end, with its end time, as the last working day', async () => {
    // Notice on Oct 2 would run to Oct 16, but the signed terms end Oct 5 at noon.
    freezeNow('2026-10-02T16:00:00Z');
    const published: Array<Published> = [];
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [
        proposedVersion({
          status: 'accepted',
          decidedAt: new Date(),
          startsOn: '2026-09-01',
          endsOn: '2026-10-05',
          endsAtMinutes: 720
        })
      ],
      published
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({
      id: CONTRACT_ID,
      status: 'ending',
      endsOn: '2026-10-05',
      endsAtMinutes: 720
    });
    expect(published[0].input).toMatchObject({
      type: 'contract.ended',
      payload: { endsOn: '2026-10-05', endsAtMinutes: 720 }
    });
  });

  it('keeps the notice date when the negotiated end is later', async () => {
    freezeNow('2026-10-02T16:00:00Z');
    const layer = makeLayer({
      contractById: baseContract({ status: 'active' }),
      versions: [
        proposedVersion({
          status: 'accepted',
          decidedAt: new Date(),
          startsOn: '2026-09-01',
          endsOn: '2026-12-11',
          endsAtMinutes: 720
        })
      ]
    });

    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

    expect(result).toMatchObject({ endsOn: '2026-10-16', endsAtMinutes: null });
  });

  it('refuses a contract that already presents as ended (past its negotiated end)', async () => {
    // Oct 2 in Winnipeg; the signed terms ended Oct 1. Stored status is still active.
    freezeNow('2026-10-02T16:00:00Z');
    const calls: Array<string> = [];
    const published: Array<Published> = [];
    const exit = await Effect.runPromiseExit(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                status: 'accepted',
                decidedAt: new Date(),
                startsOn: '2026-09-01',
                endsOn: '2026-10-01'
              })
            ],
            calls,
            published
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
    expect(calls).toEqual([]);
    expect(published).toEqual([]);
  });

  it('still allows notice on the negotiated last day itself', async () => {
    freezeNow('2026-10-02T16:00:00Z');
    const result = await Effect.runPromise(
      endContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: {} }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [
              proposedVersion({
                status: 'accepted',
                decidedAt: new Date(),
                startsOn: '2026-09-01',
                endsOn: '2026-10-02'
              })
            ]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'ending', endsOn: '2026-10-02' });
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

  it('reveals contact details once active and offers ending to both sides', async () => {
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
    expect(contract.actions).toMatchObject({ canEnd: true, canAccept: false });
  });

  it("still presents 'ending' ON the last working day — payments run through it", async () => {
    const accepted = proposedVersion({ status: 'accepted', decidedAt: new Date() });
    // Notice given exactly 14 days ago: the derived last working day is today.
    const layer = makeLayer({
      contractWithContext: withContext(
        baseContract({
          status: 'ending',
          endedByUserId: 'family-1',
          endNoticedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
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
    // Notice given 20 days ago: the derived last working day is 6 days past.
    const layer = makeLayer({
      contractWithContext: withContext(
        baseContract({
          status: 'ending',
          endedByUserId: 'provider-1',
          endNoticedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
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
    expect(contract.actions).toMatchObject({ canEnd: false });
  });

  it('presents an active contract past its agreed end date as ended', async () => {
    const accepted = proposedVersion({
      status: 'accepted',
      decidedAt: new Date(),
      endsOn: '2026-08-01'
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('ended');
    expect(contract.endsOn).toBe('2026-08-01');
    expect(contract.actions).toMatchObject({ canEnd: false });
  });

  it("keeps a contract running on its end date in the contract's own zone", async () => {
    // 06:30Z on Sep 10 is 23:30 on Sep 9 in Vancouver: the Sep 9 end date is
    // still today there, although UTC has moved on.
    freezeNow('2026-09-10T06:30:00Z');
    const accepted = proposedVersion({
      status: 'accepted',
      decidedAt: new Date(),
      endsOn: '2026-09-09',
      timeZone: 'America/Vancouver'
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );
    expect(contract.status).toBe('active');
  });

  it("gives the family's draft its zone, label and earliest start date", async () => {
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'draft' }), [draftVersion()], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({
      timeZone: WPG,
      timeZoneLabel: 'Central Time',
      earliestStartsOn: addDays(todayIn(WPG), 1),
      acceptBlockedReason: null
    });
  });

  it('leaves the zone empty for a family without a saved location', async () => {
    const layer = makeLayer({
      familyLocation: null,
      contractWithContext: withContext(baseContract({ status: 'draft' }), [draftVersion()], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({ timeZone: null, timeZoneLabel: null, earliestStartsOn: null });
    // Send would refuse with FAMILY_LOCATION_REQUIRED, so it isn't offered.
    expect(contract.actions).toMatchObject({ canEditTerms: true, canSend: false });
  });

  it("uses the family's current zone, not an old version's, while they revise", async () => {
    // v1 was sent from Vancouver and declined; the family now lives in
    // Winnipeg (makeLayer's default location). Send would stamp Winnipeg.
    const declined = proposedVersion({
      status: 'declined',
      decidedAt: new Date(),
      timeZone: 'America/Vancouver'
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'declined' }), [declined], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({
      timeZone: WPG,
      timeZoneLabel: 'Central Time',
      earliestStartsOn: addDays(todayIn(WPG), 1)
    });
  });

  it('withholds Accept without calling a missing start date "passed"', async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [proposedVersion({ startsOn: null, sentAt: new Date() })],
        'provider-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.acceptBlockedReason).toBeNull();
    expect(contract.actions).toMatchObject({ canAccept: false, canDecline: true });
  });

  it('tells the provider why Accept is gone once the start date has arrived', async () => {
    freezeNow('2026-09-10T05:30:00Z');
    const pending = proposedVersion({
      startsOn: '2026-09-10',
      sentAt: new Date('2026-09-08T12:00:00Z')
    });
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(baseContract({ status: 'proposed' }), [pending], 'provider-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.acceptBlockedReason).toBe('start_date_passed');
    expect(contract.actions).toMatchObject({ canAccept: false, canDecline: true });
    expect(contract.timeZone).toBe(WPG);
  });

  it('exposes the negotiated last-day end time with the effective end', async () => {
    const accepted = proposedVersion({
      status: 'accepted',
      decidedAt: new Date(),
      endsOn: '2099-12-11',
      endsAtMinutes: 720
    });
    const layer = makeLayer({
      contractWithContext: withContext(baseContract({ status: 'active' }), [accepted], 'family-1'),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract).toMatchObject({ endsOn: '2099-12-11', endsAtMinutes: 720 });
    expect(contract.acceptedVersion).toMatchObject({ endsAtMinutes: 720 });
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
      services: [serviceItem({ name: 'Childcare', rateCents: 2600 })]
    });
    const privateDraftV2 = draftVersion({
      id: 'version-2',
      version: 2,
      services: [
        serviceItem({
          serviceId: OTHER_SERVICE_ID,
          name: 'Secret new plan',
          rateCents: 5000
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
