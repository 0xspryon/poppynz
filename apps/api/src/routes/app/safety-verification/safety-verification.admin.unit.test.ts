import { SqlError } from '@effect/sql/SqlError';
import {
  DBNotFoundError,
  makeCheckOrderRepoTest,
  makeKycDocumentTypeRepoTest,
  makeSafetyVerificationRepoTest,
  makeSessionRepoTest,
  makeUserProfileRepoTest,
  makeUserRepoTest,
  type KycDocumentType,
  type SafetyVerification,
  type Session,
  type User
} from '@repo/db';
import { makeObjectStorageTest, ObjectStorageError } from '@repo/objs';
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeAuthServiceTest } from '@/api/lib/effect-auth';
import {
  getSafetyVerificationFileUrlRouteProgram,
  listSafetyVerificationsForReviewRouteProgram
} from './safety-verification.handler';

// UAT #29: the admin queue names the person and the document, and an
// uploaded document can be opened.

const admin: User = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  isAnonymous: false,
  role: 'admin',
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null
};

const session = { id: 'session-1', userId: 'admin-1' } as Session;

const verification = (overrides: Partial<SafetyVerification> = {}): SafetyVerification =>
  ({
    id: 'sv-1',
    userId: 'family-1',
    role: 'family',
    status: 'review_required',
    route: 'uploaded_document',
    checkOrderId: null,
    consentAt: null,
    consentPolicyVersion: null,
    issuingAuthority: 'Toronto Police Service',
    documentNumber: 'VSC-1',
    filename: 'vsc.pdf',
    fileKey: 'users/family-1/vsc.pdf',
    issuedOn: '2026-01-01',
    expiresOn: '2027-01-01',
    reviewedBy: null,
    reviewedAt: null,
    decisionReason: null,
    expiryNotifiedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as SafetyVerification;

const gateType = {
  id: 'gate-family',
  name: 'Vulnerable Sector Check',
  appliesToRole: 'family',
  isSafetyGate: true
} as KycDocumentType;

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error('Expected effect to fail');
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error('Expected typed failure');
  return failure.value;
};

const config = ConfigProvider.fromMap(
  new Map([
    ['OBJS_KYC_BUCKET', 'kyc'],
    ['OBJS_PUBLIC_BUCKET', 'public']
  ])
);

const makeLayer = (
  options: {
    records?: Array<SafetyVerification>;
    hasPermission?: boolean;
    storageFails?: boolean;
    profileError?: SqlError;
  } = {}
) => {
  const records = options.records ?? [verification()];
  return Layer.mergeAll(
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: admin.id }, session: { id: session.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true)
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(admin),
      findByEmail: () => Effect.succeed(admin)
    }),
    makeSessionRepoTest({ findById: () => Effect.succeed(session) }),
    makeUserProfileRepoTest({
      create: () => Effect.die('not used'),
      findByUserId: (userId) =>
        options.profileError
          ? Effect.fail(options.profileError)
          : userId === 'family-1'
            ? Effect.succeed({
                userId,
                email: 'priya@example.com',
                firstName: 'Priya',
                lastName: 'K'
              } as never)
            : Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateByUserId: () => Effect.die('not used'),
      updateLocationByUserId: () => Effect.die('not used')
    }),
    makeKycDocumentTypeRepoTest({
      listActive: () => Effect.succeed([gateType]),
      findActiveById: () => Effect.die('not used'),
      create: () => Effect.die('not used'),
      update: () => Effect.die('not used'),
      softDelete: () => Effect.die('not used')
    }),
    makeSafetyVerificationRepoTest({
      findLive: () => Effect.succeed(null),
      findById: (id) => {
        const found = records.find((record) => record.id === id);
        return found
          ? Effect.succeed(found)
          : Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: id }));
      },
      listByUser: () => Effect.succeed([]),
      listForReview: () => Effect.succeed(records),
      create: () => Effect.die('not used'),
      update: () => Effect.die('not used'),
      listExpiringForNotification: () => Effect.succeed([]),
      markExpiryNotified: () => Effect.die('not used'),
      listLapsed: () => Effect.succeed([])
    }),
    makeCheckOrderRepoTest({ listWithItems: () => Effect.succeed([]) }),
    makeObjectStorageTest({
      ensureBucketExists: () => Effect.void,
      ensurePublicReadBucket: () => Effect.void,
      createPresignedGetUrl: (input) =>
        options.storageFails
          ? Effect.fail(new ObjectStorageError({ operation: 'presign-get', cause: 'down' } as never))
          : Effect.succeed({
              url: `https://files.test/${input.bucket}/${input.key}`,
              expiresAt: new Date('2026-08-01T00:05:00.000Z')
            }),
      createPresignedPutUrl: () => Effect.die('not used')
    })
  );
};

describe('admin safety verification queue (UAT #29)', () => {
  it("names the applicant and the document instead of a bare user id", async () => {
    const result = await Effect.runPromise(
      listSafetyVerificationsForReviewRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer())
      )
    );
    expect(result.verifications[0]).toMatchObject({
      id: 'sv-1',
      applicant: { name: 'Priya K', email: 'priya@example.com' },
      documentTypeName: 'Vulnerable Sector Check',
      hasFile: true
    });
  });

  it('degrades to no name when the profile is gone', async () => {
    const result = await Effect.runPromise(
      listSafetyVerificationsForReviewRouteProgram(new Headers()).pipe(
        Effect.provide(makeLayer({ records: [verification({ userId: 'ghost' })] }))
      )
    );
    expect(result.verifications[0]?.applicant).toEqual({ name: null, email: null });
  });

  it('translates a profile lookup failure to a repo error', async () => {
    const exit = await Effect.runPromise(
      listSafetyVerificationsForReviewRouteProgram(new Headers()).pipe(
        Effect.provide(
          makeLayer({ profileError: new SqlError({ cause: new Error('x'), message: 'x' }) })
        ),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('SafetyVerificationRepoError');
  });

  it('mints a short-lived inline link to an uploaded document', async () => {
    const result = await Effect.runPromise(
      getSafetyVerificationFileUrlRouteProgram(new Headers(), 'sv-1').pipe(
        Effect.provide(makeLayer()),
        Effect.withConfigProvider(config)
      )
    );
    expect(result).toMatchObject({
      url: 'https://files.test/kyc/users/family-1/vsc.pdf',
      filename: 'vsc.pdf'
    });
  });

  it('has no file for a Credibled verdict', async () => {
    const exit = await Effect.runPromise(
      getSafetyVerificationFileUrlRouteProgram(new Headers(), 'sv-2').pipe(
        Effect.provide(
          makeLayer({
            records: [verification({ id: 'sv-2', route: 'credibled', fileKey: null })]
          })
        ),
        Effect.withConfigProvider(config),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('SafetyVerificationNotFoundError');
  });

  it('translates a storage failure', async () => {
    const exit = await Effect.runPromise(
      getSafetyVerificationFileUrlRouteProgram(new Headers(), 'sv-1').pipe(
        Effect.provide(makeLayer({ storageFails: true })),
        Effect.withConfigProvider(config),
        Effect.exit
      )
    );
    expect(getFailure(exit)._tag).toBe('SafetyVerificationFileError');
  });

  it('denies reviewers without safetyVerification review', async () => {
    for (const program of [
      listSafetyVerificationsForReviewRouteProgram(new Headers()),
      getSafetyVerificationFileUrlRouteProgram(new Headers(), 'sv-1')
    ]) {
      const exit = await Effect.runPromise(
        (program as unknown as Effect.Effect<unknown, { _tag: string }, never>).pipe(
          Effect.provide(makeLayer({ hasPermission: false })),
          Effect.withConfigProvider(config),
          Effect.exit
        )
      );
      expect(getFailure(exit)._tag).toBe('ForbiddenError');
    }
  });
});
