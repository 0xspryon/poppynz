import type { SqlError } from "@effect/sql/SqlError";
import {
  ApprovalRepo,
  ApprovalRequestRepo,
  type DBNotFoundError,
  UserProfileRepo,
  type Approval,
  type ApprovalRequest,
  type SafeUserProfile,
} from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions, type UserAndSession } from "@/api/lib/effect-auth";
import { loadProviderChecklist } from "@/api/lib/provider-onboarding";

export class OnboardingRepoError extends Data.TaggedError("OnboardingRepoError")<{ cause: SqlError }> { }
export class OnboardingProfileNotFoundError extends Data.TaggedError("OnboardingProfileNotFoundError")<{}> { }
export class OnboardingRoleError extends Data.TaggedError("OnboardingRoleError")<{}> { }

const mapRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(Effect.mapError((cause) => new OnboardingRepoError({ cause })));

const nullOnNotFound = <A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) =>
  effect.pipe(
    Effect.catchTags({
      DBNotFoundError: () => Effect.succeed(null),
      SqlError: (cause) => Effect.fail(new OnboardingRepoError({ cause })),
    }),
  );

const profileMissingFields = (profile: SafeUserProfile) => {
  const missing: Array<"firstName" | "lastName" | "phoneNumber" | "location" | "shortBio"> = [];
  if (!profile.firstName?.trim()) missing.push("firstName");
  if (!profile.lastName?.trim()) missing.push("lastName");
  if (!profile.phoneNumber?.trim()) missing.push("phoneNumber");
  if (typeof profile.latitude !== "number" || typeof profile.longitude !== "number") missing.push("location");
  if (!profile.shortBio?.trim()) missing.push("shortBio");
  return missing;
};

const toApprovalSummary = (approval: Approval | null) => approval
  ? {
    id: approval.id,
    approvalRequestId: approval.approvalRequestId,
    grantedAt: approval.createdAt.toISOString(),
    expiresAt: approval.expiresAt.toISOString(),
  }
  : null;

const toRequestSummary = (request: ApprovalRequest | null) => request
  ? {
    id: request.id,
    status: request.status,
    reason: request.reason,
    submittedAt: request.createdAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
  }
  : null;

const ensureServiceProvider = <T extends { user: { role: string | null } }>(userAndSession: T) =>
  userAndSession.user.role === "service-provider"
    ? Effect.succeed(userAndSession)
    : Effect.fail(new OnboardingRoleError());

export const getOnboardingProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const provider = yield* ensureServiceProvider(userAndSession);
    const userId = provider.user.id;

    const profileRepo = yield* UserProfileRepo;
    const approvalRepo = yield* ApprovalRepo;
    const approvalRequestRepo = yield* ApprovalRequestRepo;

    const profile = yield* profileRepo.findByUserId(userId).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new OnboardingProfileNotFoundError()),
        SqlError: (cause) => Effect.fail(new OnboardingRepoError({ cause })),
      }),
    );
    const [{ checklist, services, warnings }, approval, latestRequest] = yield* Effect.all([
      mapRepoError(loadProviderChecklist(userId)),
      nullOnNotFound(approvalRepo.findCurrentByUserId(userId)),
      nullOnNotFound(approvalRequestRepo.findLatestByUserId(userId)),
    ], { concurrency: "unbounded" });

    const missingFields = profileMissingFields(profile);
    const requiredEntries = checklist.filter((entry) => !entry.isOptional);
    const requiredSubmitted = requiredEntries.filter((entry) => entry.status !== "missing").length;
    const profileComplete = missingFields.length === 0;
    const servicesComplete = services.length > 0;

    return {
      userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      progress: {
        completed: (profileComplete ? 1 : 0) + requiredSubmitted + (servicesComplete ? 1 : 0),
        total: 2 + requiredEntries.length,
      },
      steps: {
        profile: { complete: profileComplete, missingFields },
        documents: {
          complete: requiredSubmitted === requiredEntries.length,
          requiredSubmitted,
          requiredTotal: requiredEntries.length,
        },
        services: { complete: servicesComplete, count: services.length },
      },
      documents: checklist,
      approval: toApprovalSummary(approval),
      latestApprovalRequest: toRequestSummary(latestRequest),
      canSubmit: latestRequest?.status !== "submitted",
      warnings,
    };
  });

export const getOnboardingRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { profile: ["read"] })(authenticated);
    return yield* getOnboardingProgram(userAndSession);
  });

export const getOnboardingHistoryProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const provider = yield* ensureServiceProvider(userAndSession);
    const userId = provider.user.id;

    const approvalRepo = yield* ApprovalRepo;
    const approvalRequestRepo = yield* ApprovalRequestRepo;
    const [requests, approvals] = yield* Effect.all([
      mapRepoError(approvalRequestRepo.listByUserId(userId)),
      mapRepoError(approvalRepo.listByUserId(userId)),
    ], { concurrency: "unbounded" });

    return {
      requests: requests.map((request) => ({
        id: request.id,
        status: request.status,
        reason: request.reason,
        submittedAt: request.createdAt.toISOString(),
        reviewedAt: request.reviewedAt?.toISOString() ?? null,
      })),
      approvals: approvals.map((approval) => ({
        id: approval.id,
        approvalRequestId: approval.approvalRequestId,
        status: approval.status,
        grantedAt: approval.createdAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
      })),
    };
  });

export const getOnboardingHistoryRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { profile: ["read"] })(authenticated);
    return yield* getOnboardingHistoryProgram(userAndSession);
  });

export type OnboardingRouteError =
  | Effect.Effect.Error<ReturnType<typeof getOnboardingRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getOnboardingHistoryRouteProgram>>;

const onboardingErrorToResponse = (c: HonoContext<HonoEnv>, error: OnboardingRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "OnboardingRoleError":
      return c.json({ error: { code: "ONBOARDING_ROLE_FORBIDDEN" as const, message: "Onboarding state is only available to service providers." } }, 403);
    case "OnboardingProfileNotFoundError":
      return c.json({ error: { code: "PROFILE_NOT_FOUND" as const, message: "Profile was not found." } }, 404);
    case "OnboardingRepoError":
      return c.json({ error: { code: "ONBOARDING_LOOKUP_FAILED" as const, message: "Unable to load onboarding state." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, OnboardingRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return onboardingErrorToResponse(c, failure.value);
      }

      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function getOnboardingHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(getOnboardingRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function getOnboardingHistoryHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(getOnboardingHistoryRouteProgram(headers));
  return exitToResponse(c, exit);
}
