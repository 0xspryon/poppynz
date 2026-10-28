import { makeIdleContractBillingLayer } from '@repo/billing';
import { SqlError } from '@effect/sql/SqlError';
import {
  dummyBillingCustomer,
  dummyContract,
  dummyContractVersion,
  dummyPayoutAccount,
  makeApprovalRepoTest,
  makeContractRepoTest,
  makeConversationRepoTest,
  makeInMemoryBillingCustomerRepo,
  makeInMemoryContractBillingRepo,
  ContractBillingRepo,
  dummyContractBilling,
  dummyContractCycle,
  makePayoutAccountRepoTest,
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
  type PayoutAccountStatus,
  type SafeUserProfile,
  type ServiceOffered,
  type Session,
  type User,
  dummyConversation
} from '@repo/db';
import {
  emptyTcDocumentRepo,
  makeContractAgreementRepoTest,
  makeTcDocumentRepoTest,
  type ContractAgreementSignature,
  type TcDocument,
  type TcDocumentVersion
} from '@repo/db';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { makePaymentsTest } from '@repo/payments';
import { addDays, todayIn } from '@repo/calendar';
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { sha256Hex } from './agreement';
import {
  acceptContractRouteProgram,
  contractLandingRouteProgram,
  contractsBadgeCountRouteProgram,
  createContractRouteProgram,
  declineContractRouteProgram,
  endContractRouteProgram,
  getContractCycleRouteProgram,
  getContractRouteProgram,
  listContractsRouteProgram,
  quoteTermsRouteProgram,
  markContractSeenRouteProgram,
  renewContractRouteProgram,
  requestChangesRouteProgram,
  retryContractPaymentRouteProgram,
  saveTermsRouteProgram,
  sendContractRouteProgram,
  toThreadContractSummary,
  withdrawContractRouteProgram
} from './contracts.handler';

const CONTRACT_ID = '0198a3b0-0000-7000-8000-00000000c001';
const NEW_CONTRACT_ID = '0198a3b0-0000-7000-8000-00000000c002';
const CYCLE_ID = '0198a3b0-0000-7000-8000-00000000cc01';
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
  location: { latitude: number; longitude: number } | null = null,
  stateProvince: string | null = null
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
  stateProvince,
  shortBio: null,
  googlePlaceId: null,
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null
});

const offeredService = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  reviewStatus: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
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

// The written service agreement (UAT round 2, item 4): a template without
// placeholders renders to itself, so its hash is known up front.
const AGREEMENT_TEXT = 'Service agreement between the family and the helper.';
const agreementDocument: TcDocument = {
  id: 'agreement-doc',
  slug: 'service_agreement',
  title: 'Service Agreement',
  appliesToRole: 'all',
  kind: 'service_agreement',
  deletedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z')
};
const agreementVersion: TcDocumentVersion = {
  id: 'agreement-v1-en',
  documentId: 'agreement-doc',
  locale: 'en',
  version: 1,
  description: 'Default',
  content: AGREEMENT_TEXT,
  checkboxLabel: 'I have read and agree.',
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z')
};
const SIGNED = {
  signed: true,
  agreement: { versionId: agreementVersion.id, sha256: sha256Hex(AGREEMENT_TEXT) }
};

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
    /** The catalogue base rate behind every offered service (null = custom). */
    catalogueBaseRateCents?: number | null;
    createFailsWith?: SqlError;
    listForUserFailsWith?: SqlError;
    /** Per-call findByConversationId results (consumed in order). */
    findByConversationIdResults?: Array<Contract | null>;
    /** Every contract of the conversation (listByConversationId), per call. */
    conversationContractsResults?: Array<Array<Contract>>;
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
    /** Whether the family has a card on file. Defaults to true. */
    familyCard?: boolean;
    /** The helper's stored payout status; null/undefined = no payout account. */
    payoutAccountStatus?: PayoutAccountStatus | null;
    /** Whose payout account that is. Defaults to the helper (provider-1); the
     * stub finds it only for that user id. */
    payoutAccountOwner?: string;
    /** Profile provinces (sales tax); null = none. Default MB family, ON helper. */
    familyProvince?: string | null;
    helperProvince?: string | null;
    /** Contract billing state (piece 3); defaults to none. */
    billing?: ReturnType<typeof makeInMemoryContractBillingRepo>;
    onAcceptPending?: (options: unknown) => void;
    /** Agreement signatures already on the contract. */
    agreementSignatures?: Array<ContractAgreementSignature>;
  } = {}
) => {
  const viewer = options.viewer ?? familyUser();
  const counterpart = viewer.id === 'family-1' ? providerUser() : familyUser();
  return Layer.mergeAll(
    // Contract billing (piece 3) is reached by accept and the detail; inert
    // unless a test hands in billing state.
    makeIdleContractBillingLayer(),
    ...(options.billing ? [options.billing.layer] : []),
    makeTcDocumentRepoTest({
      ...emptyTcDocumentRepo,
      findServiceAgreement: () =>
        Effect.succeed({ document: agreementDocument, versions: [agreementVersion] })
    }),
    makeContractAgreementRepoTest({
      listForContract: () => Effect.succeed(options.agreementSignatures ?? [])
    }),
    // Sending needs a card on file; these suites assert other behaviour, so
    // the family has one unless a test says otherwise.
    makeInMemoryBillingCustomerRepo(options.familyCard === false ? [] : [dummyBillingCustomer()])
      .layer,
    makePaymentsTest({}),
    makePayoutAccountRepoTest({
      findByUserId: (userId) =>
        Effect.succeed(
          options.payoutAccountStatus &&
            userId === (options.payoutAccountOwner ?? providerUser().id)
            ? dummyPayoutAccount({
                userId,
                provider: 'mock',
                accountReference: `mock_acct_${userId}`,
                status: options.payoutAccountStatus
              })
            : null
        )
    }),
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
                  : options.familyLocation,
                options.familyProvince === undefined ? 'MB' : options.familyProvince
              )
            : profile(
                'provider-1',
                'Maria',
                '+1 416 555 0199',
                null,
                options.helperProvince === undefined ? 'ON' : options.helperProvince
              )
        ),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.offered ?? [offeredService()]),
      listPublishableByUserIds: () =>
        Effect.succeed(
          (options.offered ?? [offeredService()])
            .filter((service) => service.reviewStatus === 'approved')
            .map((service) => ({
              ...service,
              catalogueBaseRateCents: options.catalogueBaseRateCents ?? null
            }))
        ),
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
      listByConversationId: () =>
        Effect.succeed(
          options.conversationContractsResults && options.conversationContractsResults.length > 1
            ? (options.conversationContractsResults.shift() ?? [])
            : (options.conversationContractsResults?.[0] ?? [])
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
        options.onAcceptPending?.(acceptOptions);
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

  it('floors offers at the base rate, not half the listed rate (UAT #39)', async () => {
    // Listed at $25, custom service: the floor is the $20 platform base rate,
    // so the old half-the-listing $12.50 offer is refused.
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 1250 }] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, listedRateCents: 2500, floorRateCents: 2000 }]
    });
  });

  it("uses the catalogue item's base rate as the floor for a linked service", async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 2399 }] }
        }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            catalogueBaseRateCents: 2400
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, floorRateCents: 2400 }]
    });
  });

  it('treats a service awaiting review as not on the listing', async () => {
    const exit = await Effect.runPromiseExit(
      saveTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            offered: [offeredService({ reviewStatus: 'pending' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'UnknownContractServiceError' });
  });

  it('accepts a rate at exactly the base rate', async () => {
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
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 2000 }] }
        }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ id: CONTRACT_ID, version: 1 });
    expect(updates[0][1]).toMatchObject({
      services: [{ serviceId: SERVICE_ID, listedRateCents: 2500, rateCents: 2000 }]
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
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
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
      ).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
  });
});

describe('POST /contracts/:id/send', () => {
  it('refuses to send without the family province — the service fee is taxed by it', async () => {
    const calls: Array<string> = [];
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            familyProvince: null,
            contractById: baseContract(),
            versions: [draftVersion()],
            calls
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractProvinceRequiredError',
      party: 'family',
      viewerIsParty: true
    });
    expect(calls).toEqual([]);
  });

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
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  it('refuses to send without the explicit Sign & send confirmation (UAT #41)', async () => {
    for (const body of [undefined, {}, { signed: false }]) {
      const exit = await Effect.runPromiseExit(
        sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body }), new Headers()).pipe(
          Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] }))
        )
      );
      expect(getFailure(exit)).toMatchObject({
        _tag: 'RequestValidationError',
        code: 'CONTRACT_SIGNATURE_REQUIRED'
      });
    }
  });

  it('refuses an empty draft', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract(), versions: [draftVersion({ services: [] })] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'EmptyContractTermsError' });
  });

  it("re-checks the floor against the provider's current listing at send time", async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            // The catalogue base rate rose above the drafted 2600 since the
            // draft was saved: the floor is re-read at send time.
            offered: [offeredService({ hourlyRateCents: 6000 })],
            catalogueBaseRateCents: 3000
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'RateBelowListedError',
      violations: [{ serviceId: SERVICE_ID, listedRateCents: 6000, floorRateCents: 3000 }]
    });
  });

  it('fails without a pending draft', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [] }))
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('refuses the provider side', async () => {
    // A declined contract is provider-visible; the family's revision draft is
    // not theirs to send. (A draft-only contract would 404 instead.)
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  it('refuses to send without a card on file — contract billing charges it', async () => {
    const calls: Array<string> = [];
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            familyCard: false,
            calls
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'PaymentMethodRequiredError' });
    expect(calls).toEqual([]);
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
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  it('refuses to send terms naming a service that is listed but not publishable (R5)', async () => {
    for (const reviewStatus of ['pending', 'rejected'] as const) {
      const calls: Array<string> = [];
      const exit = await Effect.runPromiseExit(
        sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              contractById: baseContract(),
              versions: [draftVersion()],
              offered: [offeredService({ reviewStatus })],
              calls
            })
          )
        )
      );
      expect(getFailure(exit)).toMatchObject({
        _tag: 'ContractServiceNotPublishableError',
        serviceIds: [SERVICE_ID]
      });
      expect(calls).toEqual([]);
    }
  });

  it('still sends terms whose service the helper has since removed (snapshot kept)', async () => {
    const updates: Array<unknown> = [];
    await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            offered: [],
            onSendPending: (_versionId, terms) => updates.push(terms)
          })
        )
      )
    );
    expect(updates).toHaveLength(1);
  });

  it('refuses to send without a start date', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({ contractById: baseContract(), versions: [draftVersion({ startsOn: null })] })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'StartDateRequiredError', action: 'send' });
  });

  it('refuses to send while the family has no saved location', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  // Sep 10 2026 is a Thursday: the pattern's first session is 15:30 CDT
  // (20:30Z) that day in Winnipeg.
  it('refuses when the first session starts less than CONTRACT_MIN_LEAD_MINUTES away', async () => {
    freezeNow('2026-09-10T19:00:00Z'); // 14:00 in Winnipeg, 1.5 h before
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'FirstSessionTooSoonError',
      action: 'send',
      minLeadMinutes: 120
    });
  });

  it('sends a contract starting today when its first session is 2 hours or more away', async () => {
    freezeNow('2026-09-10T18:30:00Z'); // 13:30 in Winnipeg, exactly 2 h before
    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  it('measures the lead from the first session, not the start date', async () => {
    // Starts Wed Sep 9 (no session that day): the first session is Thu 15:30.
    freezeNow('2026-09-10T12:00:00Z');
    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-09' })]
          })
        )
      )
    );
    expect(result).toMatchObject({ status: 'proposed' });
  });

  it('refuses a start date already in the past', async () => {
    freezeNow('2026-09-10T12:00:00Z');
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-01' })]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'FirstSessionTooSoonError', action: 'send' });
  });

  it('reads the minimum lead from CONTRACT_MIN_LEAD_MINUTES', async () => {
    freezeNow('2026-09-10T18:00:00Z'); // 2.5 h before the first session
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion({ startsOn: '2026-09-10' })]
          })
        ),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['CONTRACT_MIN_LEAD_MINUTES', '240']]))
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'FirstSessionTooSoonError',
      minLeadMinutes: 240
    });
  });

  it('fails loudly on a malformed CONTRACT_MIN_LEAD_MINUTES', async () => {
    const exit = await Effect.runPromiseExit(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })),
        Effect.withConfigProvider(
          ConfigProvider.fromMap(new Map([['CONTRACT_MIN_LEAD_MINUTES', '30']]))
        )
      )
    );
    expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(true);
  });

  it("allows tomorrow in the family's zone even when UTC is already there", async () => {
    freezeNow('2026-09-10T04:30:00Z'); // still Sep 9, 23:30 in Winnipeg
    const result = await Effect.runPromise(
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
  it('inserts the billing schedule with the frozen rates and provinces in the acceptance', async () => {
    const accepted: Array<unknown> = [];
    await Effect.runPromise(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()],
            onAcceptPending: (acceptOptions) => accepted.push(acceptOptions)
          })
        )
      )
    );
    expect(accepted).toEqual([
      {
        activate: true,
        billing: expect.objectContaining({
          // No payout account yet: the payment-readiness gate.
          status: 'awaiting_payment_readiness',
          familyFeeBps: 500,
          providerCommissionBps: 1500,
          familyProvince: 'MB',
          helperProvince: 'ON',
          timeZone: WPG,
          startsOn: '2099-01-05',
          billableFrom: null
        }),
        // The helper's agreement signature lands in the same transaction.
        signature: expect.objectContaining({ signerSide: 'helper', signerUserId: 'provider-1' })
      }
    ]);
  });

  describe('a late booking (UAT round 2: up to 2 hours before the first session)', () => {
    // Sep 10 2026 (Thu): first session 15:30 CDT; cycle 1's capture is the
    // earlier of 07:00 (12:00Z) and 14:30 — so 12:00Z.
    const lateProposal = () =>
      proposedVersion({ startsOn: '2026-09-10', sentAt: new Date('2026-09-09T12:00:00Z') });

    it("refuses a helper without payouts once cycle 1's capture time has passed", async () => {
      freezeNow('2026-09-10T18:00:00Z'); // 13:00, 2.5 h before the first session
      const accepted: Array<unknown> = [];
      const exit = await Effect.runPromiseExit(
        acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              viewer: providerUser(),
              contractById: baseContract({ status: 'proposed' }),
              versions: [lateProposal()],
              onAcceptPending: (acceptOptions) => accepted.push(acceptOptions)
            })
          )
        )
      );
      expect(getFailure(exit)).toMatchObject({ _tag: 'PayoutsRequiredToAcceptError' });
      expect(accepted).toEqual([]);
    });

    it('accepts it for a payment-ready helper, billable at once', async () => {
      freezeNow('2026-09-10T18:00:00Z');
      const accepted: Array<any> = [];
      const result = await Effect.runPromise(
        acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              viewer: providerUser(),
              payoutAccountStatus: 'ready',
              contractById: baseContract({ status: 'proposed' }),
              versions: [lateProposal()],
              onAcceptPending: (acceptOptions) => accepted.push(acceptOptions)
            })
          )
        )
      );
      expect(result).toEqual({ id: CONTRACT_ID, status: 'active' });
      expect(accepted[0].billing).toMatchObject({
        status: 'scheduled',
        billableFrom: new Date('2026-09-10T18:00:00Z')
      });
    });

    it('lets a helper without payouts accept while the readiness deadline is still ahead', async () => {
      freezeNow('2026-09-10T05:30:00Z'); // 00:30, the capture deadline 6.5 h away
      const accepted: Array<any> = [];
      await Effect.runPromise(
        acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              viewer: providerUser(),
              contractById: baseContract({ status: 'proposed' }),
              versions: [lateProposal()],
              onAcceptPending: (acceptOptions) => accepted.push(acceptOptions)
            })
          )
        )
      );
      expect(accepted[0].billing).toMatchObject({ status: 'awaiting_payment_readiness' });
    });
  });

  it('refuses to accept when a contracted service lost its approval since the proposal (R5)', async () => {
    const accepted: Array<unknown> = [];
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()],
            offered: [offeredService({ reviewStatus: 'pending' })],
            onAcceptPending: (acceptOptions) => accepted.push(acceptOptions)
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractServiceNotPublishableError',
      serviceIds: [SERVICE_ID]
    });
    expect(accepted).toEqual([]);
  });

  it('refuses to accept until the helper has a province, telling the helper to add it', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            helperProvince: null,
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractProvinceRequiredError',
      party: 'helper',
      viewerIsParty: true
    });
  });

  it("refuses to accept a family's terms without the family's province", async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            familyProvince: 'Bavaria',
            contractById: baseContract({ status: 'proposed' }),
            versions: [proposedVersion()]
          })
        )
      )
    );
    expect(getFailure(exit)).toMatchObject({ party: 'family', viewerIsParty: false });
  });

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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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

  it('refuses accepting once the first session is less than 2 hours away', async () => {
    freezeNow('2026-09-10T19:00:00Z'); // 14:00 in Winnipeg, session at 15:30
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
    expect(getFailure(exit)).toMatchObject({
      _tag: 'FirstSessionTooSoonError',
      action: 'accept'
    });
  });

  it('refuses a sent version without a start date as START_DATE_REQUIRED, not "passed"', async () => {
    const exit = await Effect.runPromiseExit(
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
      acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers()).pipe(
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
  // Tue & Thu 2 h at $26: $104.00 a week of service.
  const detailFor = (viewer: User, extra: Parameters<typeof makeLayer>[0] = {}) =>
    Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer,
            contractWithContext: withContext(
              baseContract({ status: 'proposed' }),
              [proposedVersion()],
              viewer.id
            ),
            conversationById: activeConversation(),
            ...extra
          })
        )
      )
    );

  it('shows the family the weekly price with the 5% fee and its tax added', async () => {
    const { contract } = await detailFor(familyUser());
    expect(contract.pendingVersion?.pricing).toEqual({
      available: true,
      side: 'family',
      period: 'week',
      serviceCents: 10400,
      serviceTaxLines: [],
      feeBps: 500,
      feeCents: 520,
      feeTaxLines: [{ label: 'GST (MB) 5%', taxCents: 26 }],
      totalCents: 10946,
      holdLeadHours: 24
    });
  });

  it('shows the helper the 15% commission and its tax deducted, at the helper’s province', async () => {
    const { contract } = await detailFor(providerUser());
    expect(contract.pendingVersion?.pricing).toEqual({
      available: true,
      side: 'provider',
      period: 'week',
      serviceCents: 10400,
      serviceTaxLines: [],
      commissionBps: 1500,
      commissionCents: 1560,
      commissionTaxLines: [{ label: 'HST (ON) 13%', taxCents: 203 }],
      shareCents: 8637
    });
  });

  it('says why there is no price when a province is missing', async () => {
    const { contract } = await detailFor(providerUser(), { helperProvince: null });
    expect(contract.pendingVersion?.pricing).toEqual({
      available: false,
      reason: 'tax_province_required',
      missingProvinceOf: 'helper'
    });
  });

  it('shows the billing state and the viewer’s amount per cycle', async () => {
    const billing = makeInMemoryContractBillingRepo({
      billing: [
        dummyContractBilling({ contractId: CONTRACT_ID, status: 'active', familyProvince: 'MB' })
      ]
    });
    billing.state.cycles.push(
      dummyContractCycle({
        id: 'cycle-1',
        contractId: CONTRACT_ID,
        status: 'captured',
        familyTotalCents: 10946,
        capturedCents: 10946,
        providerShareCents: 8637,
        taxLines: [
          {
            supplyType: 'family_service_fee',
            jurisdiction: 'MB',
            component: 'gst',
            rateMillipercent: 5000,
            baseCents: 520,
            taxCents: 26,
            label: 'GST (MB) 5%',
            registrationNumber: null
          },
          {
            supplyType: 'provider_commission',
            jurisdiction: 'ON',
            component: 'hst',
            rateMillipercent: 13000,
            baseCents: 1560,
            taxCents: 203,
            label: 'HST (ON) 13%',
            registrationNumber: null
          }
        ]
      })
    );
    const family = (await detailFor(familyUser(), { billing })).contract.billing;
    expect(family).toMatchObject({ status: 'active', feeBps: 500 });
    expect(family?.cycles[0]).toMatchObject({
      status: 'captured',
      amountCents: 10946,
      transferAt: null,
      taxLines: [{ label: 'GST (MB) 5%', taxCents: 26 }]
    });
    const helper = (await detailFor(providerUser(), { billing })).contract.billing;
    expect(helper).toMatchObject({ feeBps: 1500 });
    expect(helper?.cycles[0]).toMatchObject({
      amountCents: 8637,
      taxLines: [{ label: 'HST (ON) 13%', taxCents: 203 }]
    });
    expect(helper?.cycles[0]?.transferAt).not.toBeNull();
  });

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
      contractWithContext: withContext(
        baseContract({ status: 'draft' }),
        [draftVersion()],
        'family-1'
      ),
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
      earliestStartsOn: todayIn(WPG),
      acceptBlockedReason: null
    });
  });

  it('leaves the zone empty for a family without a saved location', async () => {
    const layer = makeLayer({
      familyLocation: null,
      contractWithContext: withContext(
        baseContract({ status: 'draft' }),
        [draftVersion()],
        'family-1'
      ),
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

  it('tells the family whether a card is on file and offers Send only with one', async () => {
    const detail = (familyCard: boolean) =>
      Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              familyCard,
              contractWithContext: withContext(
                baseContract({ status: 'draft' }),
                [draftVersion()],
                'family-1'
              ),
              conversationById: activeConversation()
            })
          )
        )
      );

    const withCard = (await detail(true)).contract;
    expect(withCard.hasPaymentMethod).toBe(true);
    expect(withCard.actions.canSend).toBe(true);

    const withoutCard = (await detail(false)).contract;
    expect(withoutCard.hasPaymentMethod).toBe(false);
    expect(withoutCard.actions).toMatchObject({ canEditTerms: true, canSend: false });
  });

  it('does not tell the provider about the family card', async () => {
    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            viewer: providerUser(),
            contractWithContext: withContext(
              baseContract({ status: 'proposed' }),
              [proposedVersion()],
              'provider-1'
            ),
            conversationById: activeConversation()
          })
        )
      )
    );
    expect(contract.hasPaymentMethod).toBeNull();
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
      contractWithContext: withContext(
        baseContract({ status: 'declined' }),
        [declined],
        'family-1'
      ),
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
      earliestStartsOn: todayIn(WPG)
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

  it('tells the provider why Accept is gone once the first session is too close', async () => {
    freezeNow('2026-09-10T19:00:00Z');
    const pending = proposedVersion({
      startsOn: '2026-09-10',
      sentAt: new Date('2026-09-08T12:00:00Z')
    });
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [pending],
        'provider-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.acceptBlockedReason).toBe('starts_too_soon');
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

  describe('payoutsReady (reminder only — never blocks accepting)', () => {
    const helperLayer = (
      payoutAccountStatus?: PayoutAccountStatus | null,
      payoutAccountOwner?: string
    ) =>
      makeLayer({
        viewer: providerUser(),
        contractWithContext: withContext(
          baseContract({ status: 'proposed' }),
          [proposedVersion()],
          'provider-1'
        ),
        conversationById: activeConversation(),
        payoutAccountStatus,
        payoutAccountOwner
      });

    it('is false for a helper without a payout account, and Accept stays available', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer(null))
        )
      );
      expect(contract.payoutsReady).toBe(false);
      expect(contract.actions.canAccept).toBe(true);
    });

    it('is false while the payout account is still restricted', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer('restricted'))
        )
      );
      expect(contract.payoutsReady).toBe(false);
    });

    it('is true once the payout account is ready', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer('ready'))
        )
      );
      expect(contract.payoutsReady).toBe(true);
    });

    it("reads the helper's own payout account, not anyone else's", async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(helperLayer('ready', 'someone-else'))
        )
      );
      expect(contract.payoutsReady).toBe(false);
    });

    it('is null for the family viewer', async () => {
      const { contract } = await Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              contractWithContext: withContext(
                baseContract({ status: 'proposed' }),
                [proposedVersion()],
                'family-1'
              ),
              conversationById: activeConversation(),
              payoutAccountStatus: 'ready'
            })
          )
        )
      );
      expect(contract.payoutsReady).toBeNull();
    });
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

describe('a proposal whose start date has arrived presents as expired', () => {
  // Sep 10, 00:30 in Winnipeg — the start date has arrived in the version's zone.
  // Sep 10, 14:00 in Winnipeg: the first session (15:30) is under 2 h away.
  const ON_START_DATE = '2026-09-10T19:00:00Z';
  // Sep 9, 23:30 in Winnipeg, although UTC is already on Sep 10.
  const EVENING_BEFORE = '2026-09-10T04:30:00Z';
  const startingProposal = (overrides: Partial<ContractVersion> = {}) =>
    proposedVersion({
      startsOn: '2026-09-10',
      sentAt: new Date('2026-09-08T12:00:00Z'),
      ...overrides
    });
  const fourteenDayCutoff = () => ({
    cutoff: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    now: new Date(),
    minLeadMinutes: 120
  });

  it('lists as expired and no longer awaits the provider', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(baseContract({ status: 'proposed' }), [startingProposal()], 'provider-1')
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(list.contracts[0]).toMatchObject({ status: 'expired', awaitingYou: false });
  });

  it('lists as expired for the family too', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      contracts: [
        withContext(baseContract({ status: 'proposed' }), [startingProposal()], 'family-1')
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(list.contracts[0]).toMatchObject({ status: 'expired', awaitingYou: false });
  });

  it('still presents as proposed and awaiting the evening before, in the contract zone', async () => {
    freezeNow(EVENING_BEFORE);
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(baseContract({ status: 'proposed' }), [startingProposal()], 'provider-1')
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(list.contracts[0]).toMatchObject({ status: 'proposed', awaitingYou: true });
  });

  it('leaves a legacy sent version without a start date as proposed', async () => {
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(
          baseContract({ status: 'proposed' }),
          [proposedVersion({ startsOn: null })],
          'provider-1'
        )
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );

    expect(list.contracts[0]).toMatchObject({ status: 'proposed', awaitingYou: true });
  });

  it('shows the chat pill as expired and not awaiting the provider', () => {
    freezeNow(ON_START_DATE);
    const summary = toThreadContractSummary(
      baseContract({ status: 'proposed' }),
      [startingProposal()],
      'provider-1',
      fourteenDayCutoff()
    );
    expect(summary).toMatchObject({ status: 'expired', awaitingYou: false });
  });

  it.each([
    ['its start date arrived', () => startingProposal()],
    [
      'the 14-day window passed',
      () => proposedVersion({ sentAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) })
    ]
  ])('is no longer news for the receiver once %s', async (_cause, version) => {
    freezeNow(ON_START_DATE);
    // Unseen by the provider: before it expired, this proposal was news.
    const layer = makeLayer({
      viewer: providerUser(),
      contracts: [
        withContext(
          baseContract({ status: 'proposed', providerSeenAt: null }),
          [version()],
          'provider-1'
        )
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(list.contracts[0]).toMatchObject({ status: 'expired', hasNews: false });

    const badge = await Effect.runPromise(
      contractsBadgeCountRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(badge).toEqual({ total: 0 });
  });

  it('keeps other news: the family still hears about a decision on their earlier version', async () => {
    // Only the expired proposal stops counting; decisions stay news.
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      contracts: [
        withContext(
          baseContract({ status: 'proposed', familySeenAt: null }),
          [
            proposedVersion({
              id: 'version-1',
              version: 1,
              status: 'changes_requested',
              decidedAt: new Date('2026-09-07T12:00:00Z')
            }),
            startingProposal({ id: 'version-2', version: 2 })
          ],
          'family-1'
        )
      ]
    });

    const list = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(list.contracts[0]).toMatchObject({ status: 'expired', hasNews: true });
    const badge = await Effect.runPromise(
      contractsBadgeCountRouteProgram(new Headers()).pipe(Effect.provide(layer))
    );
    expect(badge).toEqual({ total: 1 });
  });

  it('detail presents expired and explains why Accept is gone; decline stays', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      viewer: providerUser(),
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [startingProposal()],
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
    expect(contract.acceptBlockedReason).toBe('starts_too_soon');
    expect(contract.actions).toMatchObject({
      canAccept: false,
      canDecline: true,
      canRequestChanges: true
    });
  });

  it('detail lets the family withdraw and gives them the reason too', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      contractWithContext: withContext(
        baseContract({ status: 'proposed' }),
        [startingProposal()],
        'family-1'
      ),
      conversationById: activeConversation()
    });

    const { contract } = await Effect.runPromise(
      getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

    expect(contract.status).toBe('expired');
    expect(contract.acceptBlockedReason).toBe('starts_too_soon');
    expect(contract.actions).toMatchObject({ canWithdraw: true, canAccept: false });
  });

  it('still allows the provider to decline it', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      viewer: providerUser(),
      contractById: baseContract({ status: 'proposed' }),
      versions: [startingProposal()],
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

  it('still allows the family to withdraw it', async () => {
    freezeNow(ON_START_DATE);
    const layer = makeLayer({
      contractById: baseContract({ status: 'proposed' }),
      versions: [startingProposal()]
    });
    const result = await Effect.runPromise(
      withdrawContractRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );
    expect(result).toEqual({ id: CONTRACT_ID, status: 'draft' });
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
      () => sendContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers())
    ],
    [
      'withdraw',
      () =>
        withdrawContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'accept',
      () => acceptContractRouteProgram(makeContext({ params: { id: CONTRACT_ID }, body: SIGNED }), new Headers())
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
    ],
    [
      'renew',
      () => renewContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers())
    ],
    [
      'retry payment',
      () =>
        retryContractPaymentRouteProgram(
          makeContext({ params: { id: CONTRACT_ID } }),
          new Headers()
        )
    ],
    [
      'cycle',
      () =>
        getContractCycleRouteProgram(
          makeContext({ params: { id: CONTRACT_ID, cycleId: CYCLE_ID } }),
          new Headers()
        )
    ],
    ['landing', () => contractLandingRouteProgram(new Headers())]
  ];

  it.each(cases)(
    'fails %s with ForbiddenError when the contract permission is missing',
    async (_name, program) => {
      const exit = await Effect.runPromiseExit(program().pipe(Effect.provide(denied())));
      expect(getFailure(exit)).toMatchObject({ _tag: 'ForbiddenError' });
    }
  );
});

describe('contract list billing state (B5)', () => {
  it('carries the billing status so a suspended contract is not shown as active', async () => {
    const billing = makeInMemoryContractBillingRepo({
      billing: [
        dummyContractBilling({
          contractId: CONTRACT_ID,
          status: 'suspended',
          suspendedReason: 'card'
        })
      ]
    });
    const result = await Effect.runPromise(
      listContractsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({
            billing,
            contracts: [withContext(baseContract({ status: 'active' }), [], 'family-1')]
          })
        )
      )
    );
    expect(result.contracts[0]).toMatchObject({
      billingStatus: 'suspended',
      billingSuspendedReason: 'card'
    });
  });
});

describe('live quote for unsaved terms (B6)', () => {
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
  it('prices unsaved terms for the family without writing anything', async () => {
    const updates: Array<unknown> = [];
    const result = await Effect.runPromise(
      quoteTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract(),
            versions: [draftVersion()],
            onUpdateTerms: (versionId, input) => updates.push([versionId, input])
          })
        )
      )
    );
    expect(result.weeklyEstimateCents).toBeGreaterThan(0);
    expect(result.pricing).toHaveProperty('available');
    expect(updates).toEqual([]);
  });

  it('applies the same floor as saving', async () => {
    const exit = await Effect.runPromiseExit(
      quoteTermsRouteProgram(
        makeContext({
          params: { id: CONTRACT_ID },
          body: { ...termsBody, services: [{ ...termsBody.services[0], rateCents: 100 }] }
        }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), versions: [draftVersion()] })))
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RateBelowListedError' });
  });

  it('is for the family only', async () => {
    const exit = await Effect.runPromiseExit(
      quoteTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(
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

  it('rejects invalid terms and denies callers without contract read', async () => {
    const invalid = await Effect.runPromiseExit(
      quoteTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: { services: 'x' } }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract() })))
    );
    expect(getFailure(invalid)).toMatchObject({ _tag: 'RequestValidationError' });
    const denied = await Effect.runPromiseExit(
      quoteTermsRouteProgram(
        makeContext({ params: { id: CONTRACT_ID }, body: termsBody }),
        new Headers()
      ).pipe(Effect.provide(makeLayer({ contractById: baseContract(), hasPermission: false })))
    );
    expect(getFailure(denied)).toMatchObject({ _tag: 'ForbiddenError' });
  });
});

// ---------------------------------------------------------------------------
// UAT round 2

const signedVersion = (overrides: Partial<ContractVersion> = {}) =>
  proposedVersion({
    status: 'accepted',
    decidedAt: new Date('2026-09-01T12:00:00Z'),
    startsOn: '2026-09-07',
    ...overrides
  });

describe('POST /contracts/:id/renew (start a new contract from this one, UAT 7b)', () => {
  const renew = (layer: ReturnType<typeof makeLayer>) =>
    Effect.runPromiseExit(
      renewContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(layer)
      )
    );

  it('opens a family-private draft pre-filled with the signed terms, dates blank', async () => {
    const created: Array<any> = [];
    const published: Array<Published> = [];
    const result = await Effect.runPromise(
      renewContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
        Effect.provide(
          makeLayer({
            contractById: baseContract({ status: 'active' }),
            versions: [signedVersion({ services: [serviceItem({ rateCents: 2700 })] })],
            conversationById: activeConversation(),
            conversationContractsResults: [[baseContract({ status: 'active' })]],
            offered: [offeredService({ hourlyRateCents: 2600 })],
            onCreate: (input) => created.push(input),
            published
          })
        )
      )
    );
    expect(result).toMatchObject({ droppedServiceIds: [] });
    expect(created).toEqual([
      {
        conversationId: CONVERSATION_ID,
        familyUserId: 'family-1',
        providerUserId: 'provider-1',
        services: [
          {
            ...serviceItem({ rateCents: 2700 }),
            // The listing as it is now; the agreed rate is kept (send
            // re-checks it against the base-rate floor).
            listedRateCents: 2600
          }
        ]
      }
    ]);
    expect(published).toEqual([]);
  });

  it('works from an ended contract too, and leaves out services no longer offered', async () => {
    const created: Array<any> = [];
    const exit = await renew(
      makeLayer({
        contractById: baseContract({ status: 'ended' }),
        versions: [
          signedVersion({
            services: [serviceItem(), serviceItem({ serviceId: OTHER_SERVICE_ID, name: 'Tutoring' })]
          })
        ],
        conversationById: activeConversation(),
        onCreate: (input) => created.push(input)
      })
    );
    expect(Exit.isSuccess(exit) && exit.value).toMatchObject({
      droppedServiceIds: [OTHER_SERVICE_ID]
    });
    expect(created[0].services.map((item: ContractServiceItem) => item.serviceId)).toEqual([
      SERVICE_ID
    ]);
  });

  it('is the family\'s to start — the helper is refused', async () => {
    const exit = await renew(
      makeLayer({
        viewer: providerUser(),
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        conversationById: activeConversation()
      })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });

  it('needs signed terms: a contract still being negotiated is refused', async () => {
    const exit = await renew(
      makeLayer({
        contractById: baseContract({ status: 'proposed' }),
        versions: [proposedVersion()],
        conversationById: activeConversation()
      })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractStateError' });
  });

  it('points at the negotiation already open in the conversation', async () => {
    const exit = await renew(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        conversationById: activeConversation(),
        conversationContractsResults: [
          [baseContract({ id: NEW_CONTRACT_ID, status: 'draft' }), baseContract({ status: 'active' })]
        ]
      })
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractExistsError',
      contractId: NEW_CONTRACT_ID
    });
  });

  it("maps a lost race (double click) to CONTRACT_EXISTS with the winner's id", async () => {
    const exit = await renew(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        conversationById: activeConversation(),
        conversationContractsResults: [
          [baseContract({ status: 'active' })],
          [baseContract({ id: NEW_CONTRACT_ID, status: 'draft' }), baseContract({ status: 'active' })]
        ],
        createFailsWith: new SqlError({ cause: { code: '23505' } })
      })
    );
    expect(getFailure(exit)).toMatchObject({
      _tag: 'ContractExistsError',
      contractId: NEW_CONTRACT_ID
    });
  });

  it('starts from an unlocked conversation only', async () => {
    const exit = await renew(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        conversationById: activeConversation({ status: 'pending' })
      })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractConversationNotActiveError' });
  });

  it('hides the contract from non-participants', async () => {
    const exit = await renew(
      makeLayer({
        viewer: familyUser({ id: 'family-2' }),
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()]
      })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });
});

describe('POST /contracts/:id/billing/retry (UAT 13)', () => {
  const graceCycle = () =>
    dummyContractCycle({
      id: CYCLE_ID,
      contractId: CONTRACT_ID,
      status: 'grace',
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
  const billingWith = (
    cycles: Array<ReturnType<typeof dummyContractCycle>>,
    overrides: Partial<ReturnType<typeof dummyContractBilling>> = {}
  ) => {
    const repo = makeInMemoryContractBillingRepo({
      billing: [dummyContractBilling({ contractId: CONTRACT_ID, ...overrides })]
    });
    repo.state.cycles.push(...cycles);
    return repo;
  };
  const retry = (layer: ReturnType<typeof makeLayer>) =>
    Effect.runPromiseExit(
      retryContractPaymentRouteProgram(
        makeContext({ params: { id: CONTRACT_ID } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

  it('runs the retry and reports what came of it', async () => {
    const billing = billingWith([graceCycle()]);
    const exit = await retry(
      makeLayer({ contractById: baseContract({ status: 'active' }), billing })
    );
    // Nothing could be charged (the hold is still declined).
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ outcome: 'declined' });
    expect(billing.state.billing.get(CONTRACT_ID)?.familyRetryAt).toBeInstanceOf(Date);
  });

  it('is also offered on a card-suspended contract', async () => {
    const billing = billingWith([], { status: 'suspended', suspendedReason: 'card' });
    const exit = await retry(
      makeLayer({ contractById: baseContract({ status: 'active' }), billing })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('refuses when there is nothing to retry', async () => {
    for (const billing of [
      billingWith([dummyContractCycle({ contractId: CONTRACT_ID, status: 'captured' })]),
      billingWith([], { status: 'suspended', suspendedReason: 'helper_not_ready' }),
      billingWith([], { status: 'suspended', suspendedReason: 'provider_unavailable' })
    ]) {
      const exit = await retry(
        makeLayer({ contractById: baseContract({ status: 'active' }), billing })
      );
      expect(getFailure(exit)).toMatchObject({ _tag: 'PaymentRetryNotNeededError' });
    }
    const none = await retry(makeLayer({ contractById: baseContract({ status: 'active' }) }));
    expect(getFailure(none)).toMatchObject({ _tag: 'PaymentRetryNotNeededError' });
  });

  it('is the family\'s only — the helper has no card to retry', async () => {
    const exit = await retry(
      makeLayer({
        viewer: providerUser(),
        contractById: baseContract({ status: 'active' }),
        billing: billingWith([graceCycle()])
      })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'NotContractActorError' });
  });

  it('runs once on a double click: the second is rate-limited for a minute', async () => {
    const billing = billingWith([graceCycle()]);
    const layer = makeLayer({ contractById: baseContract({ status: 'active' }), billing });
    expect(Exit.isSuccess(await retry(layer))).toBe(true);
    const second = await retry(layer);
    expect(getFailure(second)).toMatchObject({ _tag: 'PaymentRetryRateLimitedError' });
    expect((getFailure(second) as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(
      55
    );
  });

  it('lets exactly one of two concurrent retries through', async () => {
    const billing = billingWith([graceCycle()]);
    const layer = makeLayer({ contractById: baseContract({ status: 'active' }), billing });
    const exits = await Promise.all([retry(layer), retry(layer)]);
    expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
    expect(getFailure(exits.find(Exit.isFailure)!)).toMatchObject({
      _tag: 'PaymentRetryRateLimitedError'
    });
  });

  it('allows another retry once the minute has passed', async () => {
    const billing = billingWith([graceCycle()], {
      familyRetryAt: new Date(Date.now() - 61 * 1000)
    });
    const exit = await retry(
      makeLayer({ contractById: baseContract({ status: 'active' }), billing })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('translates a billing lookup failure into ContractRepoError', async () => {
    const repo = makeInMemoryContractBillingRepo();
    const failing = {
      ...repo,
      layer: Layer.succeed(ContractBillingRepo, {
        ...repo.service,
        findBilling: () => Effect.fail(new SqlError({ cause: 'down' }))
      })
    };
    const exit = await retry(
      makeLayer({ contractById: baseContract({ status: 'active' }), billing: failing })
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'ContractRepoError' });
  });
});

describe('GET /contracts/:id/cycles/:cycleId (UAT 11a)', () => {
  const quotedCycle = () =>
    dummyContractCycle({
      id: CYCLE_ID,
      contractId: CONTRACT_ID,
      status: 'captured',
      serviceCents: 60000,
      serviceTaxCents: 0,
      familyFeeBps: 500,
      familyFeeCents: 3000,
      familyFeeTaxCents: 150,
      familyTotalCents: 63150,
      capturedCents: 63150,
      providerCommissionBps: 1500,
      providerCommissionCents: 9000,
      providerCommissionTaxCents: 1170,
      providerShareCents: 49830,
      taxLines: [
        {
          supplyType: 'family_service_fee',
          jurisdiction: 'MB',
          component: 'gst',
          rateMillipercent: 5000,
          baseCents: 3000,
          taxCents: 150,
          label: 'GST (MB) 5%',
          registrationNumber: null
        },
        {
          supplyType: 'provider_commission',
          jurisdiction: 'ON',
          component: 'hst',
          rateMillipercent: 13000,
          baseCents: 9000,
          taxCents: 1170,
          label: 'HST (ON) 13%',
          registrationNumber: null
        }
      ] as never
    });
  const billingWithCycle = () => {
    const repo = makeInMemoryContractBillingRepo({
      billing: [
        dummyContractBilling({
          contractId: CONTRACT_ID,
          acceptedVersionId: 'version-1',
          timeZone: WPG
        })
      ]
    });
    repo.state.cycles.push(quotedCycle());
    repo.state.sessions.push({
      id: 'session-1',
      contractId: CONTRACT_ID,
      cycleId: CYCLE_ID,
      date: '2026-11-03',
      slot: `${SERVICE_ID}@930`,
      serviceId: SERVICE_ID,
      startMinutes: 930,
      endMinutes: 1050,
      startsAt: new Date('2026-11-03T21:30:00Z'),
      endsAt: new Date('2026-11-03T23:30:00Z'),
      elapsedMinutes: 120,
      rateCents: 2600,
      valueCents: 5200,
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    return repo;
  };
  const read = (layer: ReturnType<typeof makeLayer>, cycleId = CYCLE_ID) =>
    Effect.runPromiseExit(
      getContractCycleRouteProgram(
        makeContext({ params: { id: CONTRACT_ID, cycleId } }),
        new Headers()
      ).pipe(Effect.provide(layer))
    );

  it("gives the family the care, fee and fee tax, and the cycle's timetable", async () => {
    const exit = await read(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        billing: billingWithCycle()
      })
    );
    if (!Exit.isSuccess(exit)) throw new Error('expected success');
    const { cycle } = exit.value;
    expect(cycle).toMatchObject({
      id: CYCLE_ID,
      status: 'captured',
      viewerSide: 'family',
      timeZone: WPG,
      timeZoneLabel: 'Central Time',
      transferAt: null,
      counterpartName: 'Maria Tester',
      canRetryPayment: false,
      amounts: {
        side: 'family',
        serviceCents: 60000,
        feeCents: 3000,
        feeTaxLines: [{ label: 'GST (MB) 5%', taxCents: 150 }],
        totalCents: 63150,
        chargedCents: 63150
      }
    });
    // The helper's side never leaks to the family.
    expect(JSON.stringify(cycle.amounts)).not.toContain('HST (ON)');
    expect(cycle.sessions).toEqual([
      expect.objectContaining({
        id: 'session-1',
        date: '2026-11-03',
        serviceId: SERVICE_ID,
        serviceName: 'Childcare',
        startMinutes: 930,
        endMinutes: 1050,
        elapsedMinutes: 120,
        status: 'completed',
        startsAt: '2026-11-03T21:30:00.000Z',
        endsAt: '2026-11-03T23:30:00.000Z',
        // Tier 3: no resolution yet; the cutoff is 24 h earlier, Winnipeg time.
        resolution: null,
        cutoffAt: '2026-11-02T21:30:00.000Z'
      })
    ]);
    // The window explainer's numbers come from the settings.
    expect(cycle.sessionWindow).toEqual({
      windowDays: 14,
      cancellationNoticeHours: 24,
      reportResponseHours: 48,
      reportWindowHours: 48
    });
  });

  it('gives the helper the share after commission and its tax, and the transfer time', async () => {
    const exit = await read(
      makeLayer({
        viewer: providerUser(),
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        billing: billingWithCycle()
      })
    );
    if (!Exit.isSuccess(exit)) throw new Error('expected success');
    const { cycle } = exit.value;
    expect(cycle.amounts).toEqual({
      side: 'provider',
      serviceCents: 60000,
      serviceTaxLines: [],
      commissionBps: 1500,
      commissionCents: 9000,
      commissionTaxLines: [{ label: 'HST (ON) 13%', taxCents: 1170 }],
      shareCents: 49830
    });
    expect(cycle.transferAt).toBe(quotedCycle().transferAt.toISOString());
    expect(cycle.canRetryPayment).toBe(false);
  });

  it('has no amounts before the cycle is quoted, only the estimate', async () => {
    const billing = billingWithCycle();
    billing.state.cycles[0] = dummyContractCycle({
      id: CYCLE_ID,
      contractId: CONTRACT_ID,
      status: 'grace',
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    billing.state.sessions[0] = { ...billing.state.sessions[0]!, status: 'scheduled' };
    const exit = await read(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        billing
      })
    );
    if (!Exit.isSuccess(exit)) throw new Error('expected success');
    expect(exit.value.cycle).toMatchObject({
      amounts: null,
      estimatedServiceCents: 5200,
      canRetryPayment: true
    });
  });

  it("404s a cycle of another contract, an unknown cycle, and outsiders", async () => {
    const unknown = await read(
      makeLayer({
        contractById: baseContract({ status: 'active' }),
        versions: [signedVersion()],
        billing: billingWithCycle()
      }),
      '0198a3b0-0000-7000-8000-00000000cc99'
    );
    expect(getFailure(unknown)).toMatchObject({ _tag: 'ContractCycleNotFoundError' });
    const noBilling = await read(
      makeLayer({ contractById: baseContract({ status: 'active' }), versions: [signedVersion()] })
    );
    expect(getFailure(noBilling)).toMatchObject({ _tag: 'ContractCycleNotFoundError' });
    const outsider = await read(
      makeLayer({
        viewer: familyUser({ id: 'family-2' }),
        contractById: baseContract({ status: 'active' }),
        billing: billingWithCycle()
      })
    );
    expect(getFailure(outsider)).toMatchObject({ _tag: 'ContractNotFoundError' });
  });

  it('validates both ids', async () => {
    const exit = await read(
      makeLayer({ contractById: baseContract({ status: 'active' }) }),
      'not-a-uuid'
    );
    expect(getFailure(exit)).toMatchObject({ _tag: 'RequestValidationError' });
  });

  it('exposes Retry payment on the contract billing summary for the family only', async () => {
    const billing = makeInMemoryContractBillingRepo({
      billing: [
        dummyContractBilling({ contractId: CONTRACT_ID, status: 'suspended', suspendedReason: 'card' })
      ]
    });
    const detail = (viewer: User) =>
      Effect.runPromise(
        getContractRouteProgram(makeContext({ params: { id: CONTRACT_ID } }), new Headers()).pipe(
          Effect.provide(
            makeLayer({
              viewer,
              contractWithContext: withContext(
                baseContract({ status: 'active' }),
                [signedVersion()],
                viewer.id
              ),
              conversationById: activeConversation(),
              billing
            })
          )
        )
      );
    expect((await detail(familyUser())).contract.billing?.canRetryPayment).toBe(true);
    expect((await detail(providerUser())).contract.billing?.canRetryPayment).toBe(false);
  });
});

describe('GET /contracts/me/landing (UAT 5)', () => {
  const landing = (contracts: Array<ContractWithContext>, viewer = familyUser()) =>
    Effect.runPromise(
      contractLandingRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ viewer, contracts }))
      )
    );

  it('lists the running contracts: active and under notice', async () => {
    freezeNow('2026-10-26T12:00:00Z');
    const result = await landing([
      withContext(baseContract({ id: 'c-active', status: 'active' }), [signedVersion()], 'family-1'),
      withContext(
        baseContract({
          id: 'c-ending',
          status: 'ending',
          endNoticedAt: new Date('2026-10-20T12:00:00Z')
        }),
        [signedVersion()],
        'family-1'
      ),
      withContext(baseContract({ id: 'c-draft', status: 'draft' }), [draftVersion()], 'family-1'),
      withContext(baseContract({ id: 'c-ended', status: 'ended' }), [signedVersion()], 'family-1'),
      // Past its negotiated end: presents as ended.
      withContext(
        baseContract({ id: 'c-over', status: 'active' }),
        [signedVersion({ endsOn: '2026-10-01' })],
        'family-1'
      )
    ]);
    expect(result).toEqual({ activeContractIds: ['c-active', 'c-ending'] });
  });

  it('is empty without a running contract', async () => {
    expect(await landing([], providerUser())).toEqual({ activeContractIds: [] });
  });
});
