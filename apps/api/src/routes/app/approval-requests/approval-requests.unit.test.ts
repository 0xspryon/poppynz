import { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  makeApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeServiceOfferedRepoTest,
  makeSafetyVerificationRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type ApprovalRequest,
  type KycDocument,
  type KycDocumentType,
  type SafeUserProfile,
  type ServiceOffered,
  type Session,
  type User,
  type UserProfile,
  EmptyApprovalRepoTest
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import { MailerError, makeMailerTest } from '@/api/lib/mailer';
import {
  createApprovalRequestRouteProgram,
  getAdminApprovalRequestRouteProgram,
  listAdminApprovalRequestsRouteProgram,
  rejectAdminApprovalRequestRouteProgram
} from './approval-requests.handler';

const user = (overrides: Partial<User> = {}): User => ({
  id: 'provider-1',
  name: 'Provider User',
  email: 'provider@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  isAnonymous: false,
  role: 'service-provider',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  expiresAt: new Date('2026-06-13T00:00:00.000Z'),
  token: 'session-token',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ipAddress: null,
  userAgent: null,
  userId: 'provider-1',
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides
});

const approvalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'request-1',
  userId: 'provider-1',
  status: 'submitted',
  reviewedBy: null,
  reviewedAt: null,
  reason: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: 'document-type-1',
  name: 'Identity document',
  appliesToRole: 'service-provider',
  isOptional: false,
  requiresExpiryDate: true,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: 'kyc-document-1',
  userId: 'provider-1',
  documentTypeId: 'document-type-1',
  filename: 'identity.pdf',
  fileKey: 'users/provider-1/kyc/document-type-1/identity.pdf',
  status: 'submitted',
  reason: null,
  expiryDate: new Date('2027-06-12T00:00:00.000Z'),
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const serviceOffered = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: 'service-1',
  userId: 'provider-1',
  name: 'Childcare',
  description: null,
  hourlyRateCents: 2500,
  currency: 'CAD',
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  deletedAt: null,
  ...overrides
});

const profile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: 'provider-1',
  email: 'provider@example.com',
  role: 'service-provider',
  language: 'en',
  firstName: 'Provider',
  lastName: 'User',
  gender: 'female',
  phoneNumber: '555-0101',
  dateOfBirth: '1980-05-21',
  address: '123 Main Street',
  city: 'Toronto',
  postalCode: 'M5H 1A1',
  country: 'Canada',
  stateProvince: 'Ontario',
  shortBio: 'Provider profile',
  googlePlaceId: null,
  latitude: null,
  longitude: null,
  ...overrides
});

const contextWithJson = (body: unknown) => ({ req: { json: async () => body } }) as any;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const makeLayer = (
  options: {
    user?: User;
    existingSubmitted?: ApprovalRequest | null;
    createSubmittedError?: SqlError;
    hasPermission?: boolean;
    approvalRequests?: Array<ApprovalRequest>;
    profile?: SafeUserProfile;
    documentTypes?: Array<KycDocumentType>;
    documents?: Array<KycDocument>;
    services?: Array<ServiceOffered>;
    onCreateSubmitted?: (userId: string) => void;
    onReject?: (id: string, reviewedBy: string, reason: string) => void;
    sentMails?: Array<{ kind: string; mail: unknown }>;
    mailerFail?: boolean;
  } = {}
) => {
  const currentUser = options.user ?? user();
  const currentSession = session({ userId: currentUser.id });

  return Layer.mergeAll(
    // Safety verification now gates the bookable actions; these suites assert
    // other behaviour, so the applicant is verified unless a test says so.
    makeSafetyVerificationRepoTest({
      findLive: () =>
        Effect.succeed({ id: 'sv-1', status: 'verified', expiresOn: '2099-01-01' } as never),
      findById: () => Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      findByCredibledUuid: () => Effect.succeed(null),
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () =>
        Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listLapsed: () => Effect.succeed([]),
      listInFlight: () => Effect.succeed([]),
      listAwaitingOrder: () => Effect.succeed([])
    }),
    EmptyApprovalRepoTest,
    makeMailerTest({
      sendApprovalRequestSubmitted: (mail) => {
        options.sentMails?.push({ kind: 'submitted', mail });
        return options.mailerFail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      },
      sendAdminApprovalRequestSubmitted: (mail) => {
        options.sentMails?.push({ kind: 'admin-notification', mail });
        return options.mailerFail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      },
      sendApprovalRequestRejected: (mail) => {
        options.sentMails?.push({ kind: 'rejected', mail });
        return options.mailerFail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      }
    }),
    makeApprovalRequestRepoTest({
      createSubmitted: (userId) => {
        options.onCreateSubmitted?.(userId);
        return options.createSubmittedError
          ? Effect.fail(options.createSubmittedError)
          : Effect.succeed(approvalRequest({ id: 'request-created', userId }));
      },
      list: () => Effect.succeed(options.approvalRequests ?? []),
      listWithApplicant: () =>
        Effect.succeed(
          (options.approvalRequests ?? []).map((request) => ({
            ...request,
            applicant: { email: 'provider@example.com', firstName: 'Maria', lastName: 'Santos' }
          }))
        ),
      countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
      listByUserId: () => Effect.succeed([]),
      findById: (id) => {
        const request = (options.approvalRequests ?? [approvalRequest()]).find(
          (item) => item.id === id
        );
        return request
          ? Effect.succeed(request)
          : Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id }));
      },
      findSubmittedByUserId: (userId) =>
        options.existingSubmitted === null || options.existingSubmitted === undefined
          ? Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId }))
          : Effect.succeed(options.existingSubmitted),
      findLatestByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId })),
      markApproved: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id })),
      reject: (id, reviewedBy, reason) => {
        options.onReject?.(id, reviewedBy, reason);
        const request = (options.approvalRequests ?? [approvalRequest()]).find(
          (item) => item.id === id
        );
        return request
          ? Effect.succeed({
              ...request,
              status: 'rejected',
              reviewedBy,
              reviewedAt: new Date('2026-06-13T00:00:00.000Z'),
              reason
            })
          : Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id }));
      }
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(options.documentTypes ?? [documentType()]),
      findActiveById: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      create: () => Effect.fail(new SqlError({ message: 'not used' })),
      update: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      softDelete: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id }))
    }),
    makeKycDocumentRepoTest({
      findByIdWithType: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      findByUserId: () => Effect.succeed(options.documents ?? [kycDocument()]),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: () => Effect.fail(new SqlError({ message: 'not used' })),
      updateExpiryDate: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      approveSubmittedByUserId: () => Effect.succeed([])
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? [serviceOffered()]),
      create: () => Effect.fail(new SqlError({ message: 'not used' })),
      updateByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      softDeleteByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id }))
    }),
    makeUserProfileRepoTest({
      create: (input: { userId: string; language: string }) =>
        Effect.succeed({
          ...profile(),
          userId: input.userId,
          language: input.language
        } as UserProfile),
      findByUserId: (userId) =>
        userId === (options.profile ?? profile()).userId
          ? Effect.succeed(options.profile ?? profile())
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateLocationByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }))
    }),
    makeAuthServiceTest({
      getSession: () =>
        Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      // Falls back to the default provider so admin-run programs can look up
      // the applicant (e.g. rejection mail delivery).
      findById: (id) =>
        id === currentUser.id
          ? Effect.succeed(currentUser)
          : id === 'provider-1'
            ? Effect.succeed(user())
            : Effect.fail(new DBNotFoundError({ entity: 'user', value: id })),
      findByEmail: () => Effect.succeed(currentUser)
    }),
    makeSessionRepoTest({
      findById: (id) =>
        id === currentSession.id
          ? Effect.succeed(currentSession)
          : Effect.fail(new DBNotFoundError({ entity: 'session', value: id }))
    })
  );
};

describe('createApprovalRequestRouteProgram', () => {
  it('creates a submitted approval request with no warnings when onboarding data is complete', async () => {
    const createdFor: Array<string> = [];

    const result = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ onCreateSubmitted: (userId) => createdFor.push(userId) }))
      )
    );

    expect(result).toEqual({
      id: 'request-created',
      status: 'submitted',
      warnings: {
        missingRequiredDocuments: [],
        missingServicesOffered: false
      }
    });
    expect(createdFor).toEqual(['provider-1']);
  });

  it('returns warnings for missing required documents and services', async () => {
    const result = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ documents: [], services: [] }))
      )
    );

    expect(result.warnings).toEqual({
      missingRequiredDocuments: [{ documentTypeId: 'document-type-1', name: 'Identity document' }],
      missingServicesOffered: true
    });
  });

  it('sends a submitted confirmation mail to the provider', async () => {
    const sentMails: Array<{ kind: string; mail: unknown }> = [];

    await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ sentMails }))
      )
    );

    expect(sentMails).toEqual([
      { kind: 'submitted', mail: { email: 'provider@example.com', name: 'Provider User' } },
      {
        kind: 'admin-notification',
        mail: { providerName: 'Provider User', providerEmail: 'provider@example.com' }
      }
    ]);
  });

  it('still creates the request when the confirmation mail fails', async () => {
    const result = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ mailerFail: true }))
      )
    );

    expect(result.id).toBe('request-created');
  });

  it('fails when a submitted approval request already exists', async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ existingSubmitted: approvalRequest() })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ApprovalRequestAlreadySubmittedError');
  });

  it('fails when the authenticated user is not a service provider', async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ user: user({ role: 'family' }) })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ApprovalRequestValidationError');
  });

  it('propagates approval request repo SQL failures', async () => {
    const exit = await Effect.runPromise(
      createApprovalRequestRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ createSubmittedError: new SqlError({ message: 'db down' }) })),
        Effect.exit
      )
    );

    expect(getFailure(exit)).toBeInstanceOf(SqlError);
  });
});

describe('admin approval request review route programs', () => {
  it('lists approval requests', async () => {
    const requests = [
      approvalRequest({ id: 'request-1' }),
      approvalRequest({ id: 'request-2', status: 'rejected', reason: 'Missing docs' })
    ];

    const result = await Effect.runPromise(
      listAdminApprovalRequestsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ user: user({ id: 'admin-1', role: 'admin' }), approvalRequests: requests })
        )
      )
    );

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]).toMatchObject({ id: 'request-1', status: 'submitted' });
    expect(result.requests[0]?.applicant).toEqual({
      email: 'provider@example.com',
      firstName: 'Maria',
      lastName: 'Santos'
    });
  });

  it('returns an approval request review packet', async () => {
    const result = await Effect.runPromise(
      getAdminApprovalRequestRouteProgram(new Headers(), 'request-1').pipe(
        Effect.provide(
          makeLayer({ user: user({ id: 'admin-1', role: 'admin' }), documents: [], services: [] })
        )
      )
    );

    expect(result.approvalRequest).toMatchObject({ id: 'request-1', status: 'submitted' });
    expect(result.user).toEqual({
      id: 'provider-1',
      email: 'provider@example.com',
      role: 'service-provider'
    });
    expect(result.missingRequiredDocuments).toEqual([
      { documentTypeId: 'document-type-1', name: 'Identity document' }
    ]);
    expect(result.warnings).toEqual({
      missingRequiredDocuments: [{ documentTypeId: 'document-type-1', name: 'Identity document' }],
      missingServicesOffered: true
    });
  });

  it('rejects an approval request with reason', async () => {
    const rejected: Array<{ id: string; reviewedBy: string; reason: string }> = [];

    const result = await Effect.runPromise(
      rejectAdminApprovalRequestRouteProgram(
        contextWithJson({ reason: 'Missing required documents.' }),
        new Headers(),
        'request-1'
      ).pipe(
        Effect.provide(
          makeLayer({
            user: user({ id: 'admin-1', role: 'admin' }),
            onReject: (id, reviewedBy, reason) => rejected.push({ id, reviewedBy, reason })
          })
        )
      )
    );

    expect(result).toMatchObject({
      id: 'request-1',
      status: 'rejected',
      reviewedBy: 'admin-1',
      reason: 'Missing required documents.'
    });
    expect(rejected).toEqual([
      { id: 'request-1', reviewedBy: 'admin-1', reason: 'Missing required documents.' }
    ]);
  });

  it('sends a rejection mail to the applicant with the reason', async () => {
    const sentMails: Array<{ kind: string; mail: unknown }> = [];

    await Effect.runPromise(
      rejectAdminApprovalRequestRouteProgram(
        contextWithJson({ reason: 'Missing required documents.' }),
        new Headers(),
        'request-1'
      ).pipe(Effect.provide(makeLayer({ user: user({ id: 'admin-1', role: 'admin' }), sentMails })))
    );

    expect(sentMails).toEqual([
      {
        kind: 'rejected',
        mail: {
          email: 'provider@example.com',
          name: 'Provider User',
          reason: 'Missing required documents.'
        }
      }
    ]);
  });

  it('still rejects the request when the rejection mail fails', async () => {
    const result = await Effect.runPromise(
      rejectAdminApprovalRequestRouteProgram(
        contextWithJson({ reason: 'Missing required documents.' }),
        new Headers(),
        'request-1'
      ).pipe(
        Effect.provide(
          makeLayer({ user: user({ id: 'admin-1', role: 'admin' }), mailerFail: true })
        )
      )
    );

    expect(result).toMatchObject({ id: 'request-1', status: 'rejected' });
  });

  it('rejects admin review access without approval-request permission', async () => {
    const exit = await Effect.runPromise(
      listAdminApprovalRequestsRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ user: user({ id: 'admin-1', role: 'admin' }), hasPermission: false })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('ForbiddenError');
  });

  it('reject route requires a reason', async () => {
    const exit = await Effect.runPromise(
      rejectAdminApprovalRequestRouteProgram(
        contextWithJson({ reason: '' }),
        new Headers(),
        'request-1'
      ).pipe(
        Effect.provide(makeLayer({ user: user({ id: 'admin-1', role: 'admin' }) })),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('RequestValidationError');
  });
});
