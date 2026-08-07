import type { SqlError } from "@effect/sql/SqlError";
import { ApprovalRepo, ApprovalRequestRepo, DBNotFoundError, KycDocumentTypeRepo, UserProfileRepo, UserRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { Mailer, sendMailBestEffort } from "@/api/lib/mailer";
import { loadProviderChecklist, loadProviderChecklistWithTypes } from "@/api/lib/provider-onboarding";
import { parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import { approvalRequestJsonError, validateApprovalRequestRejectInput } from "./approval-requests.validator";
import { publishNotificationBestEffort } from "@repo/notify";

class ApprovalRequestValidationError extends Data.TaggedError("ApprovalRequestValidationError")<{ message: string }>{}
class ApprovalRequestAlreadySubmittedError extends Data.TaggedError("ApprovalRequestAlreadySubmittedError")<{}>{}

const ensureServiceProvider = <T extends { user: { role: string | null } }>(userAndSession: T) =>
  userAndSession.user.role === "service-provider"
    ? Effect.succeed(userAndSession)
    : Effect.fail(new ApprovalRequestValidationError({ message: "Only service providers can submit approval requests." }));

const toRequestResponse = <T extends { reviewedAt: Date | null; createdAt: Date; updatedAt: Date }>(request: T) => ({
  ...request,
  reviewedAt: request.reviewedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
});

const buildWarnings = (userId: string) =>
  loadProviderChecklist(userId).pipe(Effect.map((state) => state.warnings));

export const createApprovalRequestRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { approvalRequest: ["write"] })(authenticated);
    const provider = yield* ensureServiceProvider(userAndSession);
    const repo = yield* ApprovalRequestRepo;
    const existingSubmitted = yield* repo.findSubmittedByUserId(provider.user.id).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.succeed(null),
      }),
    );

    if (existingSubmitted) {
      return yield* Effect.fail(new ApprovalRequestAlreadySubmittedError());
    }

    const [request, warnings] = yield* Effect.all([
      repo.createSubmitted(provider.user.id),
      buildWarnings(provider.user.id),
    ], { concurrency: "unbounded" });

    const mailer = yield* Mailer;
    yield* sendMailBestEffort(
      "approval-request submitted",
      mailer.sendApprovalRequestSubmitted({
        email: provider.user.email,
        name: provider.user.name || null,
      }),
    );
    yield* sendMailBestEffort(
      "approval-request admin notification",
      mailer.sendAdminApprovalRequestSubmitted({
        providerName: provider.user.name || null,
        providerEmail: provider.user.email,
      }),
    );

    return { id: request.id, status: request.status, warnings };
  });

export const listAdminApprovalRequestsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ["read"] })(authenticated);
    const repo = yield* ApprovalRequestRepo;
    const typeRepo = yield* KycDocumentTypeRepo;
    const [requests, counts, types] = yield* Effect.all([
      repo.listWithApplicant(50),
      repo.countByStatus(),
      typeRepo.listActive(),
    ], { concurrency: "unbounded" });

    // Warnings reflect the provider's CURRENT checklist (a doc uploaded after
    // submission clears the warning) — one lookup per distinct applicant.
    const loadChecklist = loadProviderChecklistWithTypes(types);
    const userIds = [...new Set(requests.map((request) => request.userId))];
    const warningsByUser = new Map(
      yield* Effect.forEach(
        userIds,
        (userId) => loadChecklist(userId).pipe(Effect.map((state) => [userId, state.warnings] as const)),
        { concurrency: 5 },
      ),
    );

    return {
      requests: requests.map((request) => ({
        ...toRequestResponse(request),
        applicant: request.applicant,
        warnings: warningsByUser.get(request.userId) ?? { missingRequiredDocuments: [], missingServicesOffered: false },
      })),
      counts: { ...counts, total: counts.submitted + counts.approved + counts.rejected },
    };
  });

export const getAdminApprovalRequestRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ["read"] })(authenticated);
    const requestRepo = yield* ApprovalRequestRepo;
    const profileRepo = yield* UserProfileRepo;
    const approvalRepo = yield* ApprovalRepo;
    const request = yield* requestRepo.findById(id);
    const [profile, { checklist, services, warnings }, currentApproval] = yield* Effect.all([
      profileRepo.findByUserId(request.userId),
      loadProviderChecklist(request.userId),
      approvalRepo.findCurrentByUserId(request.userId).pipe(
        Effect.catchTag("DBNotFoundError", () => Effect.succeed(null)),
      ),
    ], { concurrency: "unbounded" });
    return {
      approvalRequest: toRequestResponse(request),
      currentApproval: currentApproval
        ? {
          id: currentApproval.id,
          grantedAt: currentApproval.createdAt.toISOString(),
          expiresAt: currentApproval.expiresAt.toISOString(),
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
      warnings,
    };
  });

export const rejectAdminApprovalRequestRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, approvalRequestJsonError);
    const input = yield* validateApprovalRequestRejectInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { approvalRequest: ["write"] })(authenticated);
    const repo = yield* ApprovalRequestRepo;
    const request = yield* repo.reject(id, userAndSession.user.id, input.reason);

    yield* sendMailBestEffort(
      "approval-request rejected",
      Effect.gen(function* () {
        const userRepo = yield* UserRepo;
        const mailer = yield* Mailer;
        const applicant = yield* userRepo.findById(request.userId);
        yield* mailer.sendApprovalRequestRejected({
          email: applicant.email,
          name: applicant.name || null,
          reason: input.reason,
        });
      }),
    );
    yield* publishNotificationBestEffort(request.userId, {
      type: "approval.decided",
      payload: {
        approvalRequestId: request.id,
        status: "rejected",
        reason: input.reason,
        expiresAt: null,
      },
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
    case "DBNotFoundError":
      return c.json({ error: { code: "APPROVAL_REQUEST_NOT_FOUND" as const, message: "Approval request was not found." } }, 404);
    case "SqlError":
      return c.json({ error: { code: "APPROVAL_REQUEST_REPO_ERROR" as const, message: "Unable to process approval request." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const approvalRequestsErrorToResponse = (c: HonoContext<HonoEnv>, error: ApprovalRequestsRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "RequestValidationError":
      return requestValidationErrorToResponse(c, error);
    case "ApprovalRequestValidationError":
      return c.json({ error: { code: "INVALID_APPROVAL_REQUEST" as const, message: error.message } }, 400);
    case "ApprovalRequestAlreadySubmittedError":
      return c.json({ error: { code: "APPROVAL_REQUEST_ALREADY_SUBMITTED" as const, message: "An approval request is already pending review." } }, 409);
    case "DBNotFoundError":
    case "SqlError":
      return repoErrorResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ApprovalRequestsRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return approvalRequestsErrorToResponse(c, failure.value);
      }

      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function createApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    createApprovalRequestRouteProgram(headers),
  );
  return exitToResponse(c, exit);
}

export async function listAdminApprovalRequestsHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    listAdminApprovalRequestsRouteProgram(headers),
  );
  return exitToResponse(c, exit);
}

export async function getAdminApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    getAdminApprovalRequestRouteProgram(headers, id),
  );
  return exitToResponse(c, exit);
}

export async function rejectAdminApprovalRequestHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    rejectAdminApprovalRequestRouteProgram(c, headers, id),
  );
  return exitToResponse(c, exit);
}
