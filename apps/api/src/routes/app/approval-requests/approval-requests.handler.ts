import type { SqlError } from '@effect/sql/SqlError';
import {
  ApprovalRepo,
  ApprovalRequestRepo,
  DBNotFoundError,
  KycDocumentTypeRepo,
  ServiceNeededRepo,
  UserProfileRepo,
  UserRepo
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { applicantRoleOf, type ApplicantRole } from '@/api/lib/approval-gate';
import { Mailer, sendMailBestEffort } from '@/api/lib/mailer';
import { loadChecklist, loadChecklistWithTypes } from '@/api/lib/onboarding-checklist';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  approvalRequestJsonError,
  validateApprovalRequestRejectInput
} from './approval-requests.validator';
import { publishNotificationBestEffort } from '@repo/notify';

class ApprovalRequestValidationError extends Data.TaggedError('ApprovalRequestValidationError')<{
  message: string;
}> {}
class ApprovalRequestAlreadySubmittedError extends Data.TaggedError(
  'ApprovalRequestAlreadySubmittedError'
)<{}> {}

// Families and helpers go through the same approval; admins never apply.
const ensureApplicant = <T extends { user: { role: string | null } }>(userAndSession: T) => {
  const role = applicantRoleOf(userAndSession.user.role);
  return role
    ? Effect.succeed({ userAndSession, role })
    : Effect.fail(
        new ApprovalRequestValidationError({
          message: 'Only families and service providers can submit approval requests.'
        })
      );
};

/** A stored role that is neither applicant role means a legacy or corrupt
 * row; presenting it as a helper keeps the admin queue rendering. */
const roleOrProvider = (role: string | null | undefined): ApplicantRole =>
  applicantRoleOf(role) ?? 'service-provider';

const toRequestResponse = <T extends { reviewedAt: Date | null; createdAt: Date; updatedAt: Date }>(
  request: T
) => ({
  ...request,
  reviewedAt: request.reviewedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString()
});

const buildWarnings = (userId: string, role: ApplicantRole) =>
  loadChecklist(userId, role).pipe(Effect.map((state) => state.warnings));

export const createApprovalRequestRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { approvalRequest: ['write'] })(
      authenticated
    );
    const { userAndSession: provider, role } = yield* ensureApplicant(userAndSession);
    const repo = yield* ApprovalRequestRepo;
    const existingSubmitted = yield* repo.findSubmittedByUserId(provider.user.id).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.succeed(null)
      })
    );

    if (existingSubmitted) {
      return yield* Effect.fail(new ApprovalRequestAlreadySubmittedError());
    }

    const [request, warnings] = yield* Effect.all(
      [repo.createSubmitted(provider.user.id), buildWarnings(provider.user.id, role)],
      { concurrency: 'unbounded' }
    );

    const mailer = yield* Mailer;
    yield* sendMailBestEffort(
      'approval-request submitted',
      mailer.sendApprovalRequestSubmitted({
        email: provider.user.email,
        name: provider.user.name || null,
        role
      })
    );
    yield* sendMailBestEffort(
      'approval-request admin notification',
      mailer.sendAdminApprovalRequestSubmitted({
        applicantName: provider.user.name || null,
        applicantEmail: provider.user.email,
        role
      })
    );

    return { id: request.id, status: request.status, warnings };
  });

export const listAdminApprovalRequestsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ['read'] })(authenticated);
    const repo = yield* ApprovalRequestRepo;
    const typeRepo = yield* KycDocumentTypeRepo;
    const [requests, counts, types] = yield* Effect.all(
      [repo.listWithApplicant(50), repo.countByStatus(), typeRepo.listActive()],
      { concurrency: 'unbounded' }
    );

    // Warnings reflect the applicant's CURRENT checklist (a doc uploaded after
    // submission clears the warning) — one lookup per distinct applicant,
    // built for that applicant's role since each role owes its own documents.
    const roleByUser = new Map(
      requests.map((request) => [request.userId, roleOrProvider(request.applicant.role)] as const)
    );
    const warningsByUser = new Map(
      yield* Effect.forEach(
        [...roleByUser.entries()],
        ([userId, role]) =>
          loadChecklistWithTypes(
            types,
            role
          )(userId).pipe(Effect.map((state) => [userId, state.warnings] as const)),
        { concurrency: 5 }
      )
    );

    return {
      requests: requests.map((request) => ({
        ...toRequestResponse(request),
        applicant: { ...request.applicant, role: roleOrProvider(request.applicant.role) },
        warnings: warningsByUser.get(request.userId) ?? {
          missingRequiredDocuments: [],
          missingServicesOffered: false
        }
      })),
      counts: { ...counts, total: counts.submitted + counts.approved + counts.rejected }
    };
  });

export const getAdminApprovalRequestRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ['read'] })(authenticated);
    const requestRepo = yield* ApprovalRequestRepo;
    const profileRepo = yield* UserProfileRepo;
    const approvalRepo = yield* ApprovalRepo;
    const needsRepo = yield* ServiceNeededRepo;
    const request = yield* requestRepo.findById(id);
    const profile = yield* profileRepo.findByUserId(request.userId);
    const role = roleOrProvider(profile.role);
    const [{ checklist, services, warnings }, currentApproval, servicesNeeded] = yield* Effect.all(
      [
        loadChecklist(request.userId, role),
        approvalRepo
          .findCurrentByUserId(request.userId)
          .pipe(Effect.catchTag('DBNotFoundError', () => Effect.succeed(null))),
        // A family lists what it needs rather than what it offers; the
        // reviewer sees it for context, it is not a condition of approval.
        role === 'family' ? needsRepo.listByUserId(request.userId) : Effect.succeed([])
      ],
      { concurrency: 'unbounded' }
    );
    return {
      approvalRequest: toRequestResponse(request),
      applicantRole: role,
      currentApproval: currentApproval
        ? {
            id: currentApproval.id,
            grantedAt: currentApproval.createdAt.toISOString(),
            expiresAt: currentApproval.expiresAt.toISOString()
          }
        : null,
      user: { id: profile.userId, email: profile.email, role: profile.role },
      profile,
      documents: checklist,
      missingRequiredDocuments: warnings.missingRequiredDocuments,
      optionalDocumentTypes: checklist
        .filter((entry) => entry.isOptional)
        .map((entry) => ({ id: entry.documentTypeId, name: entry.name })),
      servicesOffered: services,
      servicesNeeded: servicesNeeded.map((need) => ({
        id: need.id,
        name: need.name,
        description: need.description
      })),
      warnings
    };
  });

export const rejectAdminApprovalRequestRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  id: string
) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, approvalRequestJsonError);
    const input = yield* validateApprovalRequestRejectInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { approvalRequest: ['write'] })(
      authenticated
    );
    const repo = yield* ApprovalRequestRepo;
    const request = yield* repo.reject(id, userAndSession.user.id, input.reason);

    yield* sendMailBestEffort(
      'approval-request rejected',
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const mailer = yield* Mailer;
        const applicant = yield* userRepo.findById(request.userId);
        yield* mailer.sendApprovalRequestRejected({
          email: applicant.email,
          name: applicant.name || null,
          role: roleOrProvider(applicant.role),
          reason: input.reason
        });
      })
    );
    yield* publishNotificationBestEffort(request.userId, {
      type: 'approval.decided',
      payload: {
        approvalRequestId: request.id,
        status: 'rejected',
        reason: input.reason,
        expiresAt: null
      }
    });

    return toRequestResponse(request);
  });

export type ApprovalRequestsRouteError =
  | Effect.Effect.Error<ReturnType<typeof createApprovalRequestRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listAdminApprovalRequestsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getAdminApprovalRequestRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof rejectAdminApprovalRequestRouteProgram>>;

const repoErrorResponse = (c: HonoContext<HonoEnv>, error: SqlError | DBNotFoundError) => {
  switch (error._tag) {
    case 'DBNotFoundError':
      return c.json(
        {
          error: {
            code: 'APPROVAL_REQUEST_NOT_FOUND' as const,
            message: 'Approval request was not found.'
          }
        },
        404
      );
    case 'SqlError':
      return c.json(
        {
          error: {
            code: 'APPROVAL_REQUEST_REPO_ERROR' as const,
            message: 'Unable to process approval request.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const approvalRequestsErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: ApprovalRequestsRouteError
) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ApprovalRequestValidationError':
      return c.json(
        { error: { code: 'INVALID_APPROVAL_REQUEST' as const, message: error.message } },
        400
      );
    case 'ApprovalRequestAlreadySubmittedError':
      return c.json(
        {
          error: {
            code: 'APPROVAL_REQUEST_ALREADY_SUBMITTED' as const,
            message: 'An approval request is already pending review.'
          }
        },
        409
      );
    case 'DBNotFoundError':
    case 'SqlError':
      return repoErrorResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<T, ApprovalRequestsRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return approvalRequestsErrorToResponse(c, failure.value);
      }

      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function createApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createApprovalRequestRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function listAdminApprovalRequestsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listAdminApprovalRequestsRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function getAdminApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(getAdminApprovalRequestRouteProgram(headers, id));
  return exitToResponse(c, exit);
}

export async function rejectAdminApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const id = c.req.param('id') ?? '';
  const exit = await runtime.runPromiseExit(rejectAdminApprovalRequestRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}
