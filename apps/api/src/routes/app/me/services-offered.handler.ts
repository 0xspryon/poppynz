import type { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, ServiceOfferedRepo } from "@repo/db";
import { Cause, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import {
  serviceOfferedJsonError,
  validateServiceOfferedCreateInput,
  validateServiceOfferedUpdateInput,
} from "./services-offered.validator";

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);

const toResponse = (service: { createdAt: Date; updatedAt: Date; deletedAt: Date | null } & Record<string, unknown>) => ({
  ...service,
  createdAt: service.createdAt.toISOString(),
  updatedAt: service.updatedAt.toISOString(),
  deletedAt: service.deletedAt?.toISOString() ?? null,
});

export const listServicesOfferedRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["read"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const services = yield* repo.listByUserId(userAndSession.user.id);

    return services.map(toResponse);
  });

export const createServiceOfferedRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceOfferedJsonError);
    const input = yield* validateServiceOfferedCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["write"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.create({
      userId: userAndSession.user.id,
      name: input.name,
      description: input.description ?? null,
      hourlyRateCents: input.hourlyRateCents,
      currency: input.currency ?? "CAD",
    });

    return toResponse(service);
  });

export const updateServiceOfferedRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceOfferedJsonError);
    const input = yield* validateServiceOfferedUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["write"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.updateByIdForUser(serviceId, userAndSession.user.id, {
      ...input,
      description: input.description === undefined ? undefined : input.description,
    });

    return toResponse(service);
  });

export const deleteServiceOfferedRouteProgram = (headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["write"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.softDeleteByIdForUser(serviceId, userAndSession.user.id);

    return toResponse(service);
  });

export type ServiceOfferedRouteError =
  | Effect.Effect.Error<ReturnType<typeof listServicesOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createServiceOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateServiceOfferedRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteServiceOfferedRouteProgram>>;

const repoErrorToResponse = (c: HonoContext<HonoEnv>, error: SqlError | DBNotFoundError) => {
  switch (error._tag) {
    case "DBNotFoundError":
      return c.json({ error: { code: "SERVICE_OFFERED_NOT_FOUND" as const, message: "Service offered was not found." } }, 404);
    case "SqlError":
      return c.json({ error: { code: "SERVICE_OFFERED_REPO_ERROR" as const, message: "Unable to process service offered request." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const serviceOfferedErrorToResponse = (c: HonoContext<HonoEnv>, error: ServiceOfferedRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "RequestValidationError":
      return requestValidationErrorToResponse(c, error);
    case "DBNotFoundError":
    case "SqlError":
      return repoErrorToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ServiceOfferedRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return serviceOfferedErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    },
  });

export async function listServicesOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    listServicesOfferedRouteProgram(headers),
  );

  return exitToResponse(c, exit);
}

export async function createServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    createServiceOfferedRouteProgram(c, headers),
  );

  return exitToResponse(c, exit);
}

export async function updateServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const serviceId = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    updateServiceOfferedRouteProgram(c, headers, serviceId),
  );

  return exitToResponse(c, exit);
}

export async function deleteServiceOfferedHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const serviceId = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    deleteServiceOfferedRouteProgram(headers, serviceId),
  );

  return exitToResponse(c, exit);
}
