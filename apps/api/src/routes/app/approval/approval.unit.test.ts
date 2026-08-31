import {
  DBNotFoundError,
  makeApprovalRepoTest,
  makeApprovalRequestRepoTest,
  type Approval,
  type ApprovalCreateInput,
  type ApprovalRequest,
  makeServiceOfferedRepoTest,
  makeUserProfileRepoTest,
  makeSafetyVerificationRepoTest,
  makeUserRepoTest,
  type User
} from '@repo/db';
import { SqlError } from '@effect/sql/SqlError';
import { MailerError, makeMailerTest } from '@/api/lib/mailer';
import { makeProviderSearchQueueTest } from '@repo/queue';
import { makeProviderSearchOutboxRepoTest, type ProviderSearchOutbox } from '@repo/db';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  ApprovalRepoError,
  ApprovalRequestMismatchError,
  ApprovalRequestNotFoundError,
  createApprovalProgram,
  revokeApprovalProgram
} from './approval.handler';
import type { UserAndSession } from '@/api/lib/effect-auth';

const userAndSession: UserAndSession = {
  user: {
    id: 'admin-1',
    name: 'Admin User',
    email: 'admin@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    isAnonymous: false,
    role: 'admin',
    banned: false,
    banReason: null,
    banExpires: null,
    phoneNumber: null,
    phoneNumberVerified: null
  },
  session: {
    id: 'session-1',
    expiresAt: new Date('2026-06-13T00:00:00.000Z'),
    token: 'session-token',
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
    ipAddress: null,
    userAgent: null,
    userId: 'admin-1',
    impersonatedBy: null,
    activeOrganizationId: null
  }
};

const input = {
  userId: 'provider-1',
  approvalRequestId: 'request-1',
  expiresAt: new Date('2027-01-01T00:00:00.000Z')
};

const makeApprovalRequest = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
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

const makeApproval = (
  approvalInput: ApprovalCreateInput,
  overrides: Partial<Approval> = {}
): Approval => ({
  id: 'approval-1',
  userId: approvalInput.userId,
  approvalRequestId: approvalInput.approvalRequestId,
  status: 'approved',
  reason: null,
  approvedBy: approvalInput.approvedBy,
  expiresAt: approvalInput.expiresAt,
  notifiedExpiresInOneMonthAt: null,
  notifiedExpiresInTwoWeeksAt: null,
  notifiedExpiresInOneWeekAt: null,
  notifiedExpiresInTwoDaysAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides
});

const outbox = (userId = 'provider-1'): ProviderSearchOutbox => ({
  id: 'outbox-1',
  userId,
  status: 'pending',
  attempts: 0,
  lastError: null,
  processedAt: null,
  createdAt: new Date('2026-06-12T00:00:00.000Z'),
  updatedAt: new Date('2026-06-12T00:00:00.000Z')
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) {
    throw new Error('Expected effect to fail');
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    throw new Error('Expected typed failure');
  }

  return failure.value;
};

const makeLayer = (
  options: {
    approvalRequest?: ApprovalRequest;
    approvalRequestError?: DBNotFoundError | SqlError;
    createApprovalError?: SqlError;
    markApprovedError?: DBNotFoundError | SqlError;
    onCreateApproval?: (input: ApprovalCreateInput) => void;
    onMarkApproved?: (id: string, reviewedBy: string) => void;
    revokeSucceeds?: boolean;
    sentMails?: Array<{ kind: string; mail: unknown }>;
    mailerFail?: boolean;
  } = {}
) =>
  Layer.mergeAll(
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
    makeApprovalRepoTest({
      create: (approvalInput) => {
        options.onCreateApproval?.(approvalInput);
        return options.createApprovalError
          ? Effect.fail(options.createApprovalError)
          : Effect.succeed(makeApproval(approvalInput));
      },
      findCurrentByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId })),
      listByUserId: () => Effect.succeed([]),
      revoke: (id, reason) =>
        options.revokeSucceeds
          ? Effect.succeed(
              makeApproval(
                {
                  userId: 'provider-1',
                  approvalRequestId: 'request-1',
                  status: 'rejected',
                  approvedBy: 'admin-1',
                  expiresAt: input.expiresAt
                },
                { id, status: 'rejected', reason }
              )
            )
          : Effect.fail(new DBNotFoundError({ entity: 'approval', value: id }))
    }),
    makeUserRepoTest({
      findById: (id) =>
        Effect.succeed({
          id,
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
          phoneNumberVerified: null
        } as User),
      findByEmail: (email) => Effect.fail(new DBNotFoundError({ entity: 'user', value: email }))
    }),
    makeMailerTest({
      sendApprovalGranted: (mail) => {
        options.sentMails?.push({ kind: 'granted', mail });
        return options.mailerFail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      },
      sendApprovalRevoked: (mail) => {
        options.sentMails?.push({ kind: 'revoked', mail });
        return options.mailerFail ? Effect.fail(new MailerError({ cause: 'boom' })) : Effect.void;
      }
    }),
    makeApprovalRequestRepoTest({
      createSubmitted: (userId) => Effect.succeed(makeApprovalRequest({ userId })),
      list: () => Effect.succeed([]),
      listWithApplicant: () => Effect.succeed([]),
      countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
      listByUserId: () => Effect.succeed([]),
      findById: (id) => {
        if (options.approvalRequestError) return Effect.fail(options.approvalRequestError);
        return id === 'request-1'
          ? Effect.succeed(options.approvalRequest ?? makeApprovalRequest())
          : Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: id }));
      },
      findSubmittedByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId })),
      findLatestByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'approvalRequest', value: userId })),
      markApproved: (id, reviewedBy) => {
        options.onMarkApproved?.(id, reviewedBy);
        return options.markApprovedError
          ? Effect.fail(options.markApprovedError)
          : Effect.succeed(makeApprovalRequest({ id, reviewedBy, status: 'approved' }));
      },
      reject: (id, reviewedBy, reason) =>
        Effect.succeed(makeApprovalRequest({ id, reviewedBy, reason, status: 'rejected' }))
    }),
    makeUserProfileRepoTest({
      create: (input) =>
        Effect.succeed({ userId: input.userId, language: input.language } as never),
      findByUserId: (userId) =>
        Effect.succeed({
          userId,
          email: 'provider@example.com',
          role: 'service-provider',
          language: 'en',
          firstName: 'Provider',
          lastName: 'User',
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
          longitude: -79.3832
        }),
      updateByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId })),
      updateLocationByUserId: (userId) =>
        Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }))
    }),
    makeServiceOfferedRepoTest({
      listByUserId: (userId) =>
        Effect.succeed([
          {
            id: 'service-1',
            userId,
            name: 'Childcare',
            description: null,
            hourlyRateCents: 2500,
            currency: 'CAD',
            deletedAt: null,
            createdAt: new Date('2026-06-12T00:00:00.000Z'),
            updatedAt: new Date('2026-06-12T00:00:00.000Z')
          }
        ]),
      create: () => Effect.fail(new SqlError({ message: 'not used' })),
      updateByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id })),
      softDeleteByIdForUser: (id) =>
        Effect.fail(new DBNotFoundError({ entity: 'serviceOffered', value: id }))
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: () => Effect.succeed({ id: 'job-1', name: 'reconcile-provider' }),
      enqueueReindex: () => Effect.succeed({ id: 'job-3', name: 'reindex-all-providers' })
    }),
    makeProviderSearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed(outbox(userId)),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.succeed(outbox(id)),
      markProcessed: (id) => Effect.succeed(outbox(id)),
      markFailed: (id) => Effect.succeed(outbox(id)),
      markSupersededBefore: () => Effect.succeed(0)
    })
  );

describe('createApprovalProgram', () => {
  it('creates an approval and marks the request approved', async () => {
    const createdApprovals: Array<ApprovalCreateInput> = [];
    const markedApproved: Array<{ id: string; reviewedBy: string }> = [];

    const result = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(
          makeLayer({
            onCreateApproval: (approvalInput) => createdApprovals.push(approvalInput),
            onMarkApproved: (id, reviewedBy) => markedApproved.push({ id, reviewedBy })
          })
        )
      )
    );

    expect(result).toEqual({
      id: 'approval-1',
      userId: 'provider-1',
      approvalRequestId: 'request-1',
      approvedBy: 'admin-1',
      expiresAt: '2027-01-01T00:00:00.000Z'
    });
    expect(createdApprovals).toEqual([
      {
        userId: 'provider-1',
        approvalRequestId: 'request-1',
        status: 'approved',
        approvedBy: 'admin-1',
        expiresAt: new Date('2027-01-01T00:00:00.000Z')
      }
    ]);
    expect(markedApproved).toEqual([{ id: 'request-1', reviewedBy: 'admin-1' }]);
  });

  it('sends an approval granted mail to the provider', async () => {
    const sentMails: Array<{ kind: string; mail: unknown }> = [];

    await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(Effect.provide(makeLayer({ sentMails })))
    );

    expect(sentMails).toEqual([
      {
        kind: 'granted',
        mail: {
          email: 'provider@example.com',
          name: 'Provider',
          expiresAt: new Date('2027-01-01T00:00:00.000Z')
        }
      }
    ]);
  });

  it('still creates the approval when the granted mail fails', async () => {
    const result = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(makeLayer({ mailerFail: true }))
      )
    );

    expect(result.id).toBe('approval-1');
  });

  it('translates missing approval request to ApprovalRequestNotFoundError', async () => {
    const exit = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(
          makeLayer({
            approvalRequestError: new DBNotFoundError({
              entity: 'approvalRequest',
              value: 'request-1'
            })
          })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)).toBeInstanceOf(ApprovalRequestNotFoundError);
  });

  it('fails when approval request belongs to another user', async () => {
    const exit = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(
          makeLayer({ approvalRequest: makeApprovalRequest({ userId: 'other-user' }) })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)).toBeInstanceOf(ApprovalRequestMismatchError);
  });

  it('translates approval create SQL failures to ApprovalRepoError', async () => {
    const exit = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(makeLayer({ createApprovalError: new SqlError({ message: 'db down' }) })),
        Effect.exit
      )
    );

    expect(getFailure(exit)).toBeInstanceOf(ApprovalRepoError);
  });

  it('translates mark-approved not-found failures to ApprovalRequestNotFoundError', async () => {
    const exit = await Effect.runPromise(
      createApprovalProgram(userAndSession, input).pipe(
        Effect.provide(
          makeLayer({
            markApprovedError: new DBNotFoundError({
              entity: 'approvalRequest',
              value: 'request-1'
            })
          })
        ),
        Effect.exit
      )
    );

    expect(getFailure(exit)).toBeInstanceOf(ApprovalRequestNotFoundError);
  });
});

describe('revokeApprovalProgram', () => {
  it('sends an approval revoked mail to the provider', async () => {
    const sentMails: Array<{ kind: string; mail: unknown }> = [];

    const result = await Effect.runPromise(
      revokeApprovalProgram('approval-1', 'Expired vulnerable sector check').pipe(
        Effect.provide(makeLayer({ revokeSucceeds: true, sentMails }))
      )
    );

    expect(result.status).toBe('rejected');
    expect(sentMails).toEqual([
      {
        kind: 'revoked',
        mail: {
          email: 'provider@example.com',
          name: 'Provider User',
          reason: 'Expired vulnerable sector check'
        }
      }
    ]);
  });

  it('still revokes the approval when the revoked mail fails', async () => {
    const result = await Effect.runPromise(
      revokeApprovalProgram('approval-1', 'Expired vulnerable sector check').pipe(
        Effect.provide(makeLayer({ revokeSucceeds: true, mailerFail: true }))
      )
    );

    expect(result.status).toBe('rejected');
  });
});
