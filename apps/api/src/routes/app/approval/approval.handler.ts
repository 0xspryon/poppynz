import {
  ApprovalRepo,
  SafetyVerificationRepo,
  ApprovalRequestRepo,
  DBNotFoundError,
  ServiceOfferedRepo,
  UserProfileRepo,
  UserRepo
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { isVerified, toDateOnly } from '@/api/lib/safety-verification';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  isAuthError,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  approvalJsonError,
  validateApprovalInput,
  validateApprovalRevokeInput,
  type ApprovalInput
} from './approval.validator';
import {
  isRequestValidationError,
  parseJsonBody,
  requestValidationErrorToResponse
} from '@/api/lib/schema-validator';
import type { SqlError } from '@effect/sql/SqlError';
import { Mailer, sendMailBestEffort } from '@/api/lib/mailer';
import { scheduleProviderSearchReconcile } from '@/api/lib/provider-search-jobs';
import { publishNotificationBestEffort } from '@repo/notify';

export class ApprovalRepoError extends Data.TaggedError('ApprovalRepoError')<{ cause: SqlError }> {}
export class ApprovalRequestMismatchError extends Data.TaggedError(
  'ApprovalRequestMismatchError'
)<{}> {}
export class ApprovalRequestNotFoundError extends Data.TaggedError('ApprovalRequestNotFoundError')<{
  id: string;
}> {}
export class ApprovalEligibilityError extends Data.TaggedError('ApprovalEligibilityError')<{
  message: string;
}> {}

export const createApprovalProgram = (userAndSession: UserAndSession, input: ApprovalInput) =>
  Effect.gen(function* () {
    const approvalRepo = yield* ApprovalRepo;
    const approvalRequestRepo = yield* ApprovalRequestRepo;
    const approvalRequest = yield* approvalRequestRepo.findById(input.approvalRequestId).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(new ApprovalRepoError({ cause })),
        DBNotFoundError: () =>
          Effect.fail(new ApprovalRequestNotFoundError({ id: input.approvalRequestId }))
      })
    );

    if (approvalRequest.userId !== input.userId) {
      return yield* Effect.fail(new ApprovalRequestMismatchError());
    }

    const profileRepo = yield* UserProfileRepo;
    const serviceRepo = yield* ServiceOfferedRepo;
    const [profile, services] = yield* Effect.all(
      [profileRepo.findByUserId(input.userId), serviceRepo.listByUserId(input.userId)],
      { concurrency: 'unbounded' }
    ).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(new ApprovalRepoError({ cause })),
        DBNotFoundError: () =>
          Effect.fail(new ApprovalEligibilityError({ message: 'Provider profile was not found.' }))
      })
    );

    if (typeof profile.latitude !== 'number' || typeof profile.longitude !== 'number') {
      return yield* Effect.fail(
        new ApprovalEligibilityError({ message: 'Provider must save a location before approval.' })
      );
    }

    if (services.length === 0) {
      return yield* Effect.fail(
        new ApprovalEligibilityError({
          message: 'Provider must have at least one active service before approval.'
        })
      );
    }

    // Nobody becomes approved — and therefore searchable — without a current
    // safety verification. Enforcing it HERE rather than only in the search
    // index means the one rule covers discovery, reach-out and bookings at
    // once: the index eligibility already keys off a live approval.
    const safetyRepo = yield* SafetyVerificationRepo;
    const verification = yield* safetyRepo
      .findLive(input.userId, 'service-provider')
      .pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(new ApprovalRepoError({ cause }))));

    if (!isVerified(verification, toDateOnly(new Date()))) {
      return yield* Effect.fail(
        new ApprovalEligibilityError({
          message: 'Provider must complete Poppynz safety verification before approval.'
        })
      );
    }

    const [approval] = yield* Effect.all([
      approvalRepo
        .create({
          userId: input.userId,
          approvalRequestId: input.approvalRequestId,
          status: 'approved',
          approvedBy: userAndSession.user.id,
          expiresAt: input.expiresAt
        })
        .pipe(Effect.mapError((cause) => new ApprovalRepoError({ cause }))),

      approvalRequestRepo.markApproved(input.approvalRequestId, userAndSession.user.id).pipe(
        Effect.catchTags({
          SqlError: (cause) => Effect.fail(new ApprovalRepoError({ cause })),
          DBNotFoundError: () =>
            Effect.fail(new ApprovalRequestNotFoundError({ id: input.approvalRequestId }))
        })
      )
    ]);
    const response = {
      id: approval.id,
      userId: approval.userId,
      approvalRequestId: approval.approvalRequestId,
      approvedBy: approval.approvedBy,
      expiresAt: approval.expiresAt.toISOString()
    };

    // Indexing on grant is still required; expiry needs no delayed job — the
    // search read path filters on approvalExpiresAt and re-verifies in the DB.
    yield* scheduleProviderSearchReconcile(response.userId);

    const mailer = yield* Mailer;
    yield* sendMailBestEffort(
      'approval granted',
      mailer.sendApprovalGranted({
        email: profile.email,
        name: profile.firstName || null,
        expiresAt: approval.expiresAt
      })
    );
    yield* publishNotificationBestEffort(approval.userId, {
      type: 'approval.decided',
      payload: {
        approvalRequestId: input.approvalRequestId,
        status: 'approved',
        reason: null,
        expiresAt: approval.expiresAt.toISOString()
      }
    });

    return response;
  });

export class ApprovalNotFoundError extends Data.TaggedError('ApprovalNotFoundError')<{
  id: string;
}> {}

// Revokes a live approval before its expiry (status → rejected, reason kept
// for the provider). No reconcile needed: the search read path re-verifies
// approvals in the DB, and lazy repair deletes the stale index doc the next
// time a search nominates this provider.
export const revokeApprovalProgram = (id: string, reason: string) =>
  Effect.gen(function* () {
    const approvalRepo = yield* ApprovalRepo;
    const revoked = yield* approvalRepo.revoke(id, reason).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(new ApprovalRepoError({ cause })),
        DBNotFoundError: () => Effect.fail(new ApprovalNotFoundError({ id }))
      })
    );

    yield* sendMailBestEffort(
      'approval revoked',
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const mailer = yield* Mailer;
        const provider = yield* userRepo.findById(revoked.userId);
        yield* mailer.sendApprovalRevoked({
          email: provider.email,
          name: provider.name || null,
          reason
        });
      })
    );
    yield* publishNotificationBestEffort(revoked.userId, {
      type: 'approval.revoked',
      payload: { approvalId: revoked.id, reason }
    });

    return {
      id: revoked.id,
      userId: revoked.userId,
      approvalRequestId: revoked.approvalRequestId,
      status: revoked.status,
      reason: revoked.reason,
      expiresAt: revoked.expiresAt.toISOString()
    };
  });

export type ApprovalError = Effect.Effect.Error<ReturnType<typeof createApprovalProgram>>;
export type ApprovalRevokeError = Effect.Effect.Error<ReturnType<typeof revokeApprovalProgram>>;

const approvalErrorToResponse = (c: HonoContext<HonoEnv>, error: ApprovalError) => {
  switch (error._tag) {
    case 'ApprovalRequestNotFoundError':
      return c.json(
        {
          error: {
            code: 'APPROVAL_REQUEST_NOT_FOUND' as const,
            message: 'Approval request was not found.'
          }
        },
        404
      );
    case 'ApprovalRequestMismatchError':
      return c.json(
        {
          error: {
            code: 'APPROVAL_REQUEST_MISMATCH' as const,
            message: 'Approval request does not belong to the target user.'
          }
        },
        400
      );
    case 'ApprovalEligibilityError':
      return c.json(
        { error: { code: 'APPROVAL_ELIGIBILITY_FAILED' as const, message: error.message } },
        400
      );
    case 'ApprovalRepoError':
      return c.json(
        { error: { code: 'APPROVAL_FAILED' as const, message: 'Unable to create approval.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const isApprovalError = (error: unknown): error is ApprovalError =>
  error instanceof ApprovalRepoError ||
  error instanceof ApprovalRequestMismatchError ||
  error instanceof ApprovalRequestNotFoundError ||
  error instanceof ApprovalEligibilityError;

export async function revokeApprovalHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const rawBody = yield* parseJsonBody(c, approvalJsonError);
      const input = yield* validateApprovalRevokeInput(rawBody);
      const authenticated = yield* authenticate(headers);
      yield* requirePermissions(headers, { approval: ['write'] })(authenticated);

      return yield* revokeApprovalProgram(id, input.reason);
    })
  );

  return Exit.match(exit, {
    onSuccess: (approval) => c.json(approval),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        if (isAuthError(failure.value)) return authErrorToResponse(c, failure.value);
        if (isRequestValidationError(failure.value))
          return requestValidationErrorToResponse(c, failure.value);
        if (failure.value instanceof ApprovalNotFoundError) {
          return c.json(
            {
              error: {
                code: 'APPROVAL_NOT_FOUND' as const,
                message: 'No active approval was found to revoke.'
              }
            },
            404
          );
        }
        if (failure.value instanceof ApprovalRepoError) {
          return c.json(
            { error: { code: 'APPROVAL_FAILED' as const, message: 'Unable to revoke approval.' } },
            500
          );
        }
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });
}

export async function createApprovalHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const rawBody = yield* parseJsonBody(c, approvalJsonError);
      const input = yield* validateApprovalInput(rawBody);
      const authenticated = yield* authenticate(headers);
      const userAndSession = yield* requirePermissions(headers, { approval: ['write'] })(
        authenticated
      );

      return yield* createApprovalProgram(userAndSession, input);
    })
  );

  return Exit.match(exit, {
    onSuccess: (approval) => c.json(approval),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        if (isAuthError(failure.value)) return authErrorToResponse(c, failure.value);
        if (isRequestValidationError(failure.value))
          return requestValidationErrorToResponse(c, failure.value);
        if (isApprovalError(failure.value)) return approvalErrorToResponse(c, failure.value);
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });
}
