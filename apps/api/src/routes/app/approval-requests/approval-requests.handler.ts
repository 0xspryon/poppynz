import type { SqlError } from "@effect/sql/SqlError";
import { ApprovalRequestRepo, DBNotFoundError, KycDocumentRepo, KycDocumentTypeRepo, ServiceOfferedRepo, UserProfileRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import { approvalRequestJsonError, validateApprovalRequestRejectInput } from "./approval-requests.validator";

class ApprovalRequestValidationError extends Data.TaggedError("ApprovalRequestValidationError")<{ message: string }>{}
class ApprovalRequestAlreadySubmittedError extends Data.TaggedError("ApprovalRequestAlreadySubmittedError")<{}>{}

const ensureServiceProvider = <T extends { user: { role: string | null } }>(userAndSession: T) =>
  userAndSession.user.role === "service-provider"
    ? Effect.succeed(userAndSession)
    : Effect.fail(new ApprovalRequestValidationError({ message: "Only service providers can submit approval requests." }));

const toRequestResponse = (request: any) => ({
  ...request,
  reviewedAt: request.reviewedAt?.toISOString() ?? null,
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
});

const buildWarnings = (userId: string) =>
  Effect.gen(function* () {
    const typeRepo = yield* KycDocumentTypeRepo;
    const docRepo = yield* KycDocumentRepo;
    const serviceRepo = yield* ServiceOfferedRepo;
    const [types, docs, services] = yield* Effect.all([
      typeRepo.listActive(),
      docRepo.findByUserId(userId),
      serviceRepo.listByUserId(userId),
    ], { concurrency: "unbounded" });
    const submittedTypeIds = new Set(docs.map((doc) => doc.documentTypeId));
    const missingRequiredDocuments = types
      .filter((type) => type.appliesToRole === "service-provider" && !type.isOptional && !submittedTypeIds.has(type.id))
      .map((type) => ({ documentTypeId: type.id, name: type.name }));

    return {
      missingRequiredDocuments,
      missingServicesOffered: services.length === 0,
    };
  });

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
    return { id: request.id, status: request.status, warnings };
  });

export const listAdminApprovalRequestsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ["read"] })(authenticated);
    const repo = yield* ApprovalRequestRepo;
    const requests = yield* repo.list(50);
    return requests.map(toRequestResponse);
  });

export const getAdminApprovalRequestRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { approvalRequest: ["read"] })(authenticated);
    const requestRepo = yield* ApprovalRequestRepo;
    const profileRepo = yield* UserProfileRepo;
    const docRepo = yield* KycDocumentRepo;
    const typeRepo = yield* KycDocumentTypeRepo;
    const serviceRepo = yield* ServiceOfferedRepo;
    const request = yield* requestRepo.findById(id);
    const [profile, docs, types, services, warnings] = yield* Effect.all([
      profileRepo.findByUserId(request.userId),
      docRepo.findByUserIdWithTypes(request.userId),
      typeRepo.listActive(),
      serviceRepo.listByUserId(request.userId),
      buildWarnings(request.userId),
    ], { concurrency: "unbounded" });
    const submittedTypeIds = new Set(docs.map((doc) => doc.documentTypeId));
    return {
      approvalRequest: toRequestResponse(request),
      user: { id: profile.userId, email: profile.email, role: profile.role },
      profile,
      kycDocuments: docs,
      missingRequiredDocuments: types.filter((type) => !type.isOptional && !submittedTypeIds.has(type.id)),
      optionalDocumentTypes: types.filter((type) => type.isOptional),
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
