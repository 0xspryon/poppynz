/** TEST SUPPORT: a contract with billing and one session, for the session
 * action and dispute-queue suites. */
import { SqlError } from '@effect/sql/SqlError';
import {
  ContractRepo,
  DBNotFoundError,
  dummyContract,
  dummyContractAgreementSignature,
  dummyContractBilling,
  emptyTcDocumentRepo,
  makeContractAgreementRepoTest,
  makeInMemoryContractBillingRepo,
  makeInMemorySessionMoneyRepo,
  makeInMemorySessionResolutionRepo,
  makeSessionRepoTest,
  makeTcDocumentRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  SessionResolutionRepo,
  type ContractAgreementSignature,
  type ConversationMessage,
  type SessionRecord,
  type SessionResolution,
  type User
} from '@repo/db';
import { makeIdleContractBillingLayer } from '@repo/billing';
import { makeMockPayments, Payments } from '@repo/payments';
import { makeMailerTest, type ContractBillingNoticeMail } from '@repo/mail';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';

/** A Hono context with route params and a JSON body. */
export const makeContext = (
  options: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {}
) =>
  ({
    req: {
      json: async () => options.body,
      param: (key: string) => options.params?.[key],
      query: (key: string) => options.query?.[key]
    },
    get: () => 'en'
  }) as unknown as HonoContext<HonoEnv>;

/** The typed failure of an exit (or null on success). */
export const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  return Option.isSome(failure) ? (failure.value as { _tag: string; reason?: string }) : null;
};

export const CONTRACT_ID = '0198a3b0-0000-7000-8000-00000000c001';
export const CONVERSATION_ID = '0198a3b0-0000-7000-8000-000000000001';
export const CYCLE_ID = '0198a3b0-0000-7000-8000-00000000cc01';
export const SESSION_ID = '0198a3b0-0000-7000-8000-00000000ee01';
export const TORONTO = 'America/Toronto';

export const user = (id: string, role: string): User =>
  ({
    id,
    name: id,
    email: `${id}@example.test`,
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    isAnonymous: false,
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null
  }) as User;

export const FAMILY = user('family-1', 'family');
export const HELPER = user('helper-1', 'service-provider');
export const ADMIN = user('admin-1', 'admin');
export const OUTSIDER = user('family-2', 'family');

// Tue 3 Nov 2026, Childcare 15:30–17:30 in Toronto (EST): 20:30–22:30 UTC.
export const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: SESSION_ID,
  contractId: CONTRACT_ID,
  cycleId: CYCLE_ID,
  date: '2026-11-03',
  slot: 'svc-1@930',
  serviceId: 'svc-1',
  serviceName: 'Childcare',
  startMinutes: 930,
  endMinutes: 1050,
  startsAt: new Date('2026-11-03T20:30:00.000Z'),
  endsAt: new Date('2026-11-03T22:30:00.000Z'),
  elapsedMinutes: 120,
  rateCents: 2500,
  valueCents: 5000,
  status: 'scheduled',
  createdAt: new Date('2026-10-20T00:00:00.000Z'),
  updatedAt: new Date('2026-10-20T00:00:00.000Z'),
  ...overrides
});

/** The cutoff for that session: Mon 2 Nov 15:30 EST. */
export const CUTOFF = new Date('2026-11-02T20:30:00.000Z');

export type Grant =
  | 'contract:read'
  | 'sessionResolution:read'
  | 'sessionResolution:write'
  | 'sessionDispute:read'
  | 'sessionDispute:decide';

export const PARTY_GRANTS: ReadonlyArray<Grant> = [
  'contract:read',
  'sessionResolution:read',
  'sessionResolution:write'
];
export const ADMIN_GRANTS: ReadonlyArray<Grant> = ['sessionDispute:read', 'sessionDispute:decide'];

export type Published = { userId: string; input: NotificationInput };

export const makeSessionWorld = (
  options: {
    viewer?: User;
    grants?: ReadonlyArray<Grant>;
    session?: Partial<SessionRecord>;
    resolutions?: Array<SessionResolution>;
    messages?: Array<ConversationMessage>;
    signatures?: Array<ContractAgreementSignature>;
    /** The Terms of Service revision published now (fallback policy). */
    publishedTermsVersion?: number | null;
    /** Every resolution-repo call fails. */
    repoDown?: boolean;
    languages?: { family?: string; helper?: string };
  } = {}
) => {
  const viewer = options.viewer ?? FAMILY;
  const grants = new Set(options.grants ?? PARTY_GRANTS);
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
  billing.state.sessions.push(session(options.session));
  const resolutions = makeInMemorySessionResolutionRepo({
    resolutions: options.resolutions ?? [],
    messages: options.messages ?? []
  });
  const resolutionService = options.repoDown
    ? Object.fromEntries(
        Object.keys(resolutions.service).map((key) => [
          key,
          () => Effect.fail(new SqlError({ cause: 'down' }))
        ])
      )
    : resolutions.service;
  const money = makeInMemorySessionMoneyRepo({ billing: billing.state });
  const mails: Array<ContractBillingNoticeMail> = [];
  const alerts: Array<string> = [];
  const published: Array<Published> = [];
  const users = [FAMILY, HELPER, ADMIN, OUTSIDER];
  const signatures = options.signatures ?? [
    dummyContractAgreementSignature({
      contractId: CONTRACT_ID,
      contractVersionId: 'version-1',
      signerUserId: 'family-1',
      signerSide: 'family',
      cancellationPolicyVersionId: 'tos-v5',
      cancellationPolicyVersion: 5,
      content: '# Service Agreement (family)'
    }),
    dummyContractAgreementSignature({
      id: 'signature-2',
      contractId: CONTRACT_ID,
      contractVersionId: 'version-1',
      signerUserId: 'helper-1',
      signerSide: 'helper',
      cancellationPolicyVersionId: 'tos-v5',
      cancellationPolicyVersion: 5,
      signedAt: new Date('2026-10-27T00:00:00.000Z'),
      content: '# Service Agreement (helper)'
    })
  ];
  const publishedTerms =
    options.publishedTermsVersion === undefined ? 6 : options.publishedTermsVersion;

  const layer = Layer.mergeAll(
    // Every contract-billing dependency the money step reaches, inert;
    // the world's own layers below override them.
    makeIdleContractBillingLayer(),
    Layer.succeed(Payments, makeMockPayments()),
    money.layer,
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
        Effect.succeed({
          id: 'session-1',
          userId: viewer.id,
          impersonatedBy: null
        } as never)
    }),
    makeUserProfileRepoTest({
      create: () => Effect.die('unused'),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          firstName: userId === 'family-1' ? 'Priya' : userId === 'helper-1' ? 'Maria' : 'Ada',
          lastName: 'Tester',
          language:
            userId === 'family-1'
              ? (options.languages?.family ?? 'en')
              : userId === 'helper-1'
                ? (options.languages?.helper ?? 'fr')
                : 'en'
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
                conversationId: CONVERSATION_ID,
                familyUserId: 'family-1',
                providerUserId: 'helper-1',
                status: 'active' as const
              }
            : null
        )
    } as unknown as Context.Tag.Service<typeof ContractRepo>),
    billing.layer,
    Layer.succeed(
      SessionResolutionRepo,
      resolutionService as Context.Tag.Service<typeof SessionResolutionRepo>
    ),
    makeContractAgreementRepoTest({
      listForContract: () => Effect.succeed(signatures)
    }),
    makeTcDocumentRepoTest({
      ...emptyTcDocumentRepo,
      findActiveBySlug: () =>
        publishedTerms === null
          ? Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: 'terms_of_service' }))
          : Effect.succeed({ id: 'tos-doc', slug: 'terms_of_service' } as never),
      listVersions: () =>
        Effect.succeed(
          publishedTerms === null
            ? []
            : ([
                {
                  id: `tos-v${publishedTerms}`,
                  documentId: 'tos-doc',
                  locale: 'en',
                  version: publishedTerms,
                  publishedAt: new Date('2026-10-01T00:00:00.000Z')
                }
              ] as never)
        )
    }),
    makeMailerTest({
      sendContractBillingNotice: (mail) => Effect.sync(() => void mails.push(mail)),
      sendAdminBillingAlert: (mail) => Effect.sync(() => void alerts.push(mail.subject))
    }),
    makeNotificationHubTest({
      publish: (userId, input) => Effect.sync(() => void published.push({ userId, input })),
      subscribe: () => Effect.succeed({ unsubscribe: async () => {} })
    })
  );
  return {
    layer,
    billing,
    money,
    resolutions,
    mails,
    alerts,
    published
  };
};
