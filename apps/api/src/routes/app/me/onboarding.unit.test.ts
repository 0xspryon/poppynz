import {
  DBNotFoundError,
  makeApprovalRepoTest,
  makeApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  makeKycDocumentTypeRepoTest,
  makeSafetyVerificationRepoTest,
  makeServiceOfferedRepoTest,
  makeUserProfileRepoTest,
  type Approval,
  type ApprovalRequest,
  type KycDocument,
  type KycDocumentType,
  type SafeUserProfile,
  type ServiceOffered
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { UserAndSession } from '@/api/lib/effect-auth';
import {
  getOnboardingHistoryProgram,
  getOnboardingProgram,
  OnboardingRoleError
} from './onboarding.handler';

const userAndSession = (
  role: UserAndSession['user']['role'] = 'service-provider'
): UserAndSession => ({
  user: {
    id: 'user-1',
    name: 'Provider User',
    email: 'provider@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    isAnonymous: false,
    role,
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null
  },
  session: {
    id: 'session-1',
    expiresAt: new Date('2026-06-13T00:00:00.000Z'),
    token: 'token',
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ipAddress: null,
    userAgent: null,
    userId: 'user-1',
    impersonatedBy: null,
    activeOrganizationId: null
  }
});

const profile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: 'user-1',
  email: 'provider@example.com',
  role: 'service-provider',
  language: 'en',
  firstName: 'Maria',
  lastName: 'Santos',
  gender: 'female',
  phoneNumber: '555-0101',
  dateOfBirth: '1990-03-14',
  address: '123 Main Street',
  city: 'Toronto',
  postalCode: 'M5H 1A1',
  country: 'CA',
  stateProvince: 'ON',
  shortBio: 'Warm, reliable helper.',
  googlePlaceId: 'place-1',
  latitude: 43.6532,
  longitude: -79.3832,
  ...overrides
});

const documentType = (overrides: Partial<KycDocumentType> = {}): KycDocumentType => ({
  id: 'document-type-1',
  name: 'Government ID',
  appliesToRole: 'service-provider',
  isOptional: false,
  requiresExpiryDate: true,
  credibledCheckTypeValue: null,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const kycDocument = (overrides: Partial<KycDocument> = {}): KycDocument => ({
  id: 'document-1',
  userId: 'user-1',
  documentTypeId: 'document-type-1',
  filename: 'passport.pdf',
  fileKey: 'users/user-1/kyc/document-type-1/passport.pdf',
  expiryDate: new Date('2029-08-12T00:00:00.000Z'),
  status: 'submitted',
  reason: null,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const serviceOffered = (overrides: Partial<ServiceOffered> = {}): ServiceOffered => ({
  id: 'service-1',
  userId: 'user-1',
  catalogueServiceId: null,
  name: 'Childcare',
  description: null,
  hourlyRateCents: 2500,
  currency: 'CAD',
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const approvalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'request-1',
  userId: 'user-1',
  status: 'submitted',
  reviewedBy: null,
  reviewedAt: null,
  reason: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: 'approval-1',
  userId: 'user-1',
  approvalRequestId: 'request-1',
  approvedBy: 'admin-1',
  status: 'approved',
  reason: null,
  expiresAt: new Date('2027-07-06T00:00:00.000Z'),
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date('2026-07-06T00:00:00.000Z'),
  updatedAt: new Date('2026-07-06T00:00:00.000Z'),
  ...overrides
});

const makeLayer = (
  options: {
    profile?: SafeUserProfile;
    documentTypes?: Array<KycDocumentType>;
    documents?: Array<KycDocument>;
    services?: Array<ServiceOffered>;
    approvals?: Array<Approval>;
    requests?: Array<ApprovalRequest>;
  } = {}
) => {
  const currentProfile = options.profile ?? profile();
  const approvals = options.approvals ?? [];
  const requests = options.requests ?? [];

  return Layer.mergeAll(
    // The checklist now reads a backing type's status from the verification
    // record, so the loader needs this repo even where no verification exists.
    makeSafetyVerificationRepoTest({
      findLive: () => Effect.succeed(null),
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
      listAwaitingOrder: () => Effect.succeed([]),
      listItems: () => Effect.succeed([]),
      addItem: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      removeItem: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }))
    }),
    makeUserProfileRepoTest({
      findByUserId: (userId) =>
        currentProfile.userId === userId
          ? Effect.succeed(currentProfile)
          : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      create: () => Effect.succeed(currentProfile),
      updateByUserId: () => Effect.succeed(currentProfile),
      updateLocationByUserId: () => Effect.succeed(currentProfile)
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(options.documentTypes ?? [documentType()]),
      findActiveById: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      create: () => Effect.succeed(documentType()),
      update: () => Effect.succeed(documentType()),
      softDelete: () => Effect.succeed(documentType({ deletedAt: new Date() }))
    }),
    makeKycDocumentRepoTest({
      findByIdWithType: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      findByUserId: () => Effect.succeed(options.documents ?? []),
      findByUserIdWithTypes: () => Effect.succeed([]),
      submit: () => Effect.succeed(kycDocument()),
      updateExpiryDate: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
      approveSubmittedByUserId: () => Effect.succeed([])
    }),
    makeServiceOfferedRepoTest({
      listByUserId: () => Effect.succeed(options.services ?? []),
      findByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      create: () => Effect.succeed(serviceOffered()),
      updateByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      softDeleteByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id }))
    }),
    makeApprovalRepoTest({
      create: () => Effect.succeed(approval()),
      findCurrentByUserId: (userId) => {
        const current = approvals.find(
          (entry) => entry.userId === userId && entry.expiresAt > new Date()
        );
        return current
          ? Effect.succeed(current)
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }));
      },
      listByUserId: (userId) =>
        Effect.succeed(approvals.filter((entry) => entry.userId === userId)),
      revoke: (id) => Effect.fail(new DBNotFoundError({ entity: 'approval', value: id }))
    }),
    makeApprovalRequestRepoTest({
      createSubmitted: (userId) => Effect.succeed(approvalRequest({ userId })),
      list: () => Effect.succeed(requests),
      listWithApplicant: () => Effect.succeed([]),
      countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
      listByUserId: (userId) => Effect.succeed(requests.filter((entry) => entry.userId === userId)),
      findById: (id) => Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id })),
      findSubmittedByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId })),
      findLatestByUserId: (userId) => {
        const latest = requests.find((entry) => entry.userId === userId);
        return latest
          ? Effect.succeed(latest)
          : Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId }));
      },
      markApproved: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id })),
      reject: (id) => Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id }))
    })
  );
};

const getFailure = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Option.getOrNull(Cause.failureOption(exit.cause)) : null;

describe('getOnboardingProgram', () => {
  it('computes per-step state and progress for a provider mid-onboarding', async () => {
    const types = [
      documentType(),
      documentType({ id: 'document-type-2', name: 'Police clearance', requiresExpiryDate: false }),
      documentType({
        id: 'document-type-3',
        name: 'Driving record',
        isOptional: true,
        credibledCheckTypeValue: 'request_motor_vehicle_records'
      }),
      documentType({ id: 'document-type-4', name: 'Admin-only doc', appliesToRole: 'admin' })
    ];
    const result = await Effect.runPromise(
      getOnboardingProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({ documentTypes: types, documents: [kycDocument()], services: [] })
        )
      )
    );

    expect(result.steps.profile).toEqual({ complete: true, missingFields: [] });
    expect(result.steps.documents).toEqual({
      complete: false,
      requiredSubmitted: 1,
      requiredTotal: 2
    });
    expect(result.steps.services).toEqual({ complete: false, count: 0 });
    // profile done + 1 of 2 required docs, out of profile + 2 docs + services
    expect(result.progress).toEqual({ completed: 2, total: 4 });
    // admin-only type is excluded from the provider checklist
    expect(result.documents.map((entry) => entry.documentTypeId)).toEqual([
      'document-type-1',
      'document-type-2',
      'document-type-3'
    ]);
    expect(result.documents[0]).toMatchObject({
      status: 'submitted',
      document: { id: 'document-1' }
    });
    expect(result.documents[1]).toMatchObject({ status: 'missing', document: null });
    expect(result.canSubmit).toBe(true);
    expect(result.warnings).toEqual({
      missingRequiredDocuments: [{ documentTypeId: 'document-type-2', name: 'Police clearance' }],
      missingServicesOffered: true
    });
  });

  it('reports missing profile fields and blocks resubmission while a request is pending', async () => {
    const result = await Effect.runPromise(
      getOnboardingProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({
            profile: profile({ firstName: null, shortBio: null, latitude: null, longitude: null }),
            requests: [approvalRequest()]
          })
        )
      )
    );

    expect(result.steps.profile.complete).toBe(false);
    expect(result.steps.profile.missingFields).toEqual(['firstName', 'location', 'shortBio']);
    expect(result.canSubmit).toBe(false);
    expect(result.latestApprovalRequest).toMatchObject({ id: 'request-1', status: 'submitted' });
  });

  it('returns the current approval when one is active', async () => {
    const result = await Effect.runPromise(
      getOnboardingProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({
            approvals: [approval()],
            requests: [
              approvalRequest({
                status: 'approved',
                reviewedAt: new Date('2026-07-06T00:00:00.000Z')
              })
            ],
            documents: [kycDocument()],
            services: [serviceOffered()]
          })
        )
      )
    );

    expect(result.approval).toEqual({
      id: 'approval-1',
      approvalRequestId: 'request-1',
      grantedAt: '2026-07-06T00:00:00.000Z',
      expiresAt: '2027-07-06T00:00:00.000Z'
    });
    expect(result.progress).toEqual({ completed: 3, total: 3 });
  });

  it('rejects non-provider roles', async () => {
    const exit = await Effect.runPromise(
      getOnboardingProgram(userAndSession('family')).pipe(Effect.provide(makeLayer()), Effect.exit)
    );

    expect(getFailure(exit)).toBeInstanceOf(OnboardingRoleError);
  });
});

describe('getOnboardingHistoryProgram', () => {
  it('returns requests and approvals for the provider', async () => {
    const result = await Effect.runPromise(
      getOnboardingHistoryProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({
            requests: [
              approvalRequest({
                id: 'request-2',
                status: 'rejected',
                reason: 'Police clearance is too old.',
                reviewedAt: new Date('2026-07-05T00:00:00.000Z')
              }),
              approvalRequest()
            ],
            approvals: [approval()]
          })
        )
      )
    );

    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]).toMatchObject({
      id: 'request-2',
      status: 'rejected',
      reason: 'Police clearance is too old.'
    });
    expect(result.approvals).toEqual([
      {
        id: 'approval-1',
        approvalRequestId: 'request-1',
        status: 'approved',
        reason: null,
        grantedAt: '2026-07-06T00:00:00.000Z',
        expiresAt: '2027-07-06T00:00:00.000Z',
        revokedAt: null
      }
    ]);
  });
});
