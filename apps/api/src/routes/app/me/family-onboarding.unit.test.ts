import {
  DBNotFoundError,
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyServiceOfferedRepoTest,
  makeKycDocumentTypeRepoTest,
  makeSafetyVerificationRepoTest,
  makeServiceNeededRepoTest,
  makeUserProfileRepoTest,
  type KycDocumentType,
  type SafeUserProfile,
  type SafetyVerification,
  type ServiceNeeded
} from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import type { UserAndSession } from '@/api/lib/effect-auth';
import { getFamilyOnboardingProgram } from './onboarding.handler';

const userAndSession = (role: UserAndSession['user']['role'] = 'family'): UserAndSession => ({
  user: {
    id: 'user-1',
    name: 'Family User',
    email: 'family@example.com',
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
  email: 'family@example.com',
  role: 'family',
  language: 'en',
  firstName: 'Fiona',
  lastName: 'Family',
  gender: null,
  phoneNumber: null,
  dateOfBirth: null,
  address: '123 Main Street',
  city: 'Toronto',
  postalCode: 'M5H 1A1',
  country: 'CA',
  stateProvince: 'ON',
  shortBio: null,
  googlePlaceId: 'place-1',
  latitude: 43.6532,
  longitude: -79.3832,
  ...overrides
});

const need = (overrides: Partial<ServiceNeeded> = {}): ServiceNeeded => ({
  id: 'need-1',
  userId: 'user-1',
  catalogueServiceId: null,
  name: 'After-school care',
  description: null,
  deletedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const gateType = (): KycDocumentType =>
  ({
    id: 'gate-family',
    name: 'Vulnerable Sector Check',
    appliesToRole: 'family',
    isOptional: false,
    requiresExpiryDate: true,
    credibledCheckTypeValue: null,
    credibledCostCents: null,
    isSafetyGate: true,
    deletedAt: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z')
  }) as KycDocumentType;

const verdict = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'user-1',
    role: 'family',
    status: 'review_required',
    route: 'uploaded_document',
    checkOrderId: null,
    filename: 'vsc.pdf',
    expiresOn: '2099-01-01',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const makeLayer = (
  options: {
    profile?: SafeUserProfile;
    needs?: Array<ServiceNeeded>;
    /** Document types owed by SOME role — the program filters to family. */
    types?: Array<KycDocumentType>;
    verification?: SafetyVerification | null;
  } = {}
) =>
  Layer.mergeAll(
    // The checklist reads the gate's status from the verdict, never from
    // kyc_documents.
    EmptyKycDocumentRepoTest,
    EmptyServiceOfferedRepoTest,
    // No approval and no request yet unless a test says otherwise.
    EmptyApprovalRepoTest,
    EmptyApprovalRequestRepoTest,
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed(options.types ?? []),
      findActiveById: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id })),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      softDelete: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }))
    }),
    makeSafetyVerificationRepoTest({
      findLive: () => Effect.succeed(options.verification ?? null),
      findById: () => Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' })),
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed([]),
      create: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' }) as never),
      update: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () => Effect.fail(new DBNotFoundError({ entity: 'x', value: '' })),
      listLapsed: () => Effect.succeed([])
    }),
    makeUserProfileRepoTest({
      create: (input) =>
        Effect.succeed({ userId: input.userId, language: input.language } as never),
      findByUserId: () => Effect.succeed(options.profile ?? profile()),
      updateByUserId: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: id })),
      updateLocationByUserId: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: id }))
    }),
    makeServiceNeededRepoTest({
      listByUserId: () => Effect.succeed(options.needs ?? [need()]),
      findByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: id })),
      create: () =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: '' }) as never),
      updateByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: id })),
      softDeleteByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: id }))
    })
  );

describe('family onboarding program', () => {
  it('reports both steps complete for a family with a location and needs', async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(Effect.provide(makeLayer()))
    );

    expect(result).toMatchObject({
      userId: 'user-1',
      firstName: 'Fiona',
      progress: { completed: 2, total: 2 },
      steps: {
        location: { complete: true },
        needs: { complete: true, count: 1 }
      }
    });
  });

  it('reports the location step incomplete without saved coordinates', async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(makeLayer({ profile: profile({ latitude: null, longitude: null }) }))
      )
    );

    expect(result.progress).toEqual({ completed: 1, total: 2 });
    expect(result.steps.location.complete).toBe(false);
  });

  it('reports the needs step incomplete when the family has no active needs', async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(Effect.provide(makeLayer({ needs: [] })))
    );

    expect(result.progress).toEqual({ completed: 1, total: 2 });
    expect(result.steps.needs).toEqual({ complete: false, count: 0 });
  });

  it('adds the safety gate as a step and reads its status from the verdict', async () => {
    // Nothing submitted: the step is open and the family is not discoverable.
    const missing = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(makeLayer({ types: [gateType()] }))
      )
    );
    expect(missing.progress).toEqual({ completed: 2, total: 3 });
    expect(missing.steps.documents).toEqual({
      complete: false,
      requiredSubmitted: 0,
      requiredTotal: 1
    });
    expect(missing.documents[0]).toMatchObject({
      name: 'Vulnerable Sector Check',
      status: 'missing'
    });
    expect(missing.safetyVerification).toEqual({
      status: 'not_started',
      verified: false,
      expiresOn: null
    });

    // Submitted: the step counts as done, but "submitted" is not "verified".
    const submitted = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(makeLayer({ types: [gateType()], verification: verdict() }))
      )
    );
    expect(submitted.progress).toEqual({ completed: 3, total: 3 });
    expect(submitted.documents[0]?.status).toBe('submitted');
    expect(submitted.safetyVerification.status).toBe('review_required');
    expect(submitted.safetyVerification.verified).toBe(false);

    // Verified: the family can now be found.
    const verified = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({ types: [gateType()], verification: verdict({ status: 'verified' }) })
        )
      )
    );
    expect(verified.documents[0]?.status).toBe('approved');
    expect(verified.safetyVerification).toEqual({
      status: 'verified',
      verified: true,
      expiresOn: '2099-01-01'
    });
  });

  it('ignores document types owed by the other role', async () => {
    const result = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession()).pipe(
        Effect.provide(
          makeLayer({
            types: [
              { ...gateType(), id: 'gate-sp', appliesToRole: 'service-provider' } as KycDocumentType
            ]
          })
        )
      )
    );
    expect(result.documents).toEqual([]);
    expect(result.progress.total).toBe(2);
  });

  it('rejects non-family roles', async () => {
    const exit = await Effect.runPromise(
      getFamilyOnboardingProgram(userAndSession('service-provider')).pipe(
        Effect.provide(makeLayer()),
        Effect.exit
      )
    );

    expect(getFailure(exit)._tag).toBe('OnboardingRoleError');
  });
});
