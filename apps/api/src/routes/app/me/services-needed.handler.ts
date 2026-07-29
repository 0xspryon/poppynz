import type { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, ServiceCatalogueRepo, type ServiceCatalogueItem, ServiceNeededRepo } from "@repo/db";
import { servicesNeededConfig } from "@repo/env";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { scheduleFamilySearchReconcile } from "@/api/lib/family-search-jobs";
import { parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import {
  serviceNeededJsonError,
  validateServiceNeededCreateInput,
  validateServiceNeededUpdateInput,
} from "./services-needed.validator";

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);

class ServiceCatalogueItemNotFoundError extends Data.TaggedError("ServiceCatalogueItemNotFoundError")<{ id: string }> { }
class ServiceCatalogueItemHiddenError extends Data.TaggedError("ServiceCatalogueItemHiddenError")<{ id: string }> { }
class ServicesNeededLimitReachedError extends Data.TaggedError("ServicesNeededLimitReachedError")<{ max: number }> { }

// Same defensive shape as the provider-search min-radius config: the env
// default (20) applies when the variable is absent or malformed.
const maxServicesPerFamily = servicesNeededConfig.pipe(
  Effect.map((config) => config.maxPerFamily),
  Effect.orElseSucceed(() => 20),
);

// Catch the catalogue repo's DBNotFoundError here so it can't fall through to
// the serviceNeeded SERVICE_NEEDED_NOT_FOUND mapping.
const findCatalogueItem = (id: string) =>
  ServiceCatalogueRepo.pipe(
    Effect.flatMap((catalogue) => catalogue.findActiveById(id)),
    Effect.catchTag("DBNotFoundError", () => Effect.fail(new ServiceCatalogueItemNotFoundError({ id }))),
  );

const ensureItemIsLive = (item: ServiceCatalogueItem) =>
  item.isLive ? Effect.void : Effect.fail(new ServiceCatalogueItemHiddenError({ id: item.id }));

const toResponse = <T extends { createdAt: Date; updatedAt: Date; deletedAt: Date | null }>(service: T) => ({
  ...service,
  createdAt: service.createdAt.toISOString(),
  updatedAt: service.updatedAt.toISOString(),
  deletedAt: service.deletedAt?.toISOString() ?? null,
});

export const listServicesNeededRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceNeeded: ["read"] })(authenticated);
    const repo = yield* ServiceNeededRepo;
    const services = yield* repo.listByUserId(userAndSession.user.id);
    const maxServicesNeeded = yield* maxServicesPerFamily;

    return { services: services.map(toResponse), maxServicesNeeded };
  });

export const createServiceNeededRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceNeededJsonError);
    const input = yield* validateServiceNeededCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceNeeded: ["write"] })(authenticated);
    if (input.catalogueServiceId != null) {
      const item = yield* findCatalogueItem(input.catalogueServiceId);
      yield* ensureItemIsLive(item);
    }
    const repo = yield* ServiceNeededRepo;
    const max = yield* maxServicesPerFamily;
    const existing = yield* repo.listByUserId(userAndSession.user.id);
    if (existing.length >= max) {
      return yield* Effect.fail(new ServicesNeededLimitReachedError({ max }));
    }
    const service = yield* repo.create({
      userId: userAndSession.user.id,
      catalogueServiceId: input.catalogueServiceId ?? null,
      name: input.name,
      description: input.description ?? null,
    });
    yield* scheduleFamilySearchReconcile(service.userId);

    return toResponse(service);
  });

export const updateServiceNeededRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceNeededJsonError);
    const input = yield* validateServiceNeededUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceNeeded: ["write"] })(authenticated);
    const repo = yield* ServiceNeededRepo;
    const existing = yield* repo.findByIdForUser(serviceId, userAndSession.user.id);
    // Same rules as services offered: an existing link to a hidden (or
    // soft-deleted) item stays valid, but LINKING to one is rejected. Strict
    // comparisons matter: `undefined` = field absent (keep as-is), explicit
    // `null` = unlink — loose equality conflates the two.
    const linkChanged = input.catalogueServiceId !== undefined && input.catalogueServiceId !== existing.catalogueServiceId;
    if (linkChanged && input.catalogueServiceId != null) {
      const item = yield* findCatalogueItem(input.catalogueServiceId);
      yield* ensureItemIsLive(item);
    }
    const service = yield* repo.updateByIdForUser(serviceId, userAndSession.user.id, {
      ...input,
      description: input.description === undefined ? undefined : input.description,
    });
    yield* scheduleFamilySearchReconcile(service.userId);

    return toResponse(service);
  });

export const deleteServiceNeededRouteProgram = (headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceNeeded: ["write"] })(authenticated);
    const repo = yield* ServiceNeededRepo;
    const service = yield* repo.softDeleteByIdForUser(serviceId, userAndSession.user.id);
    yield* scheduleFamilySearchReconcile(service.userId);

    return toResponse(service);
  });

export type ServiceNeededRouteError =
  | Effect.Effect.Error<ReturnType<typeof listServicesNeededRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createServiceNeededRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateServiceNeededRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteServiceNeededRouteProgram>>;

const repoErrorToResponse = (c: HonoContext<HonoEnv>, error: SqlError | DBNotFoundError) => {
  switch (error._tag) {
    case "DBNotFoundError":
      return c.json({ error: { code: "SERVICE_NEEDED_NOT_FOUND" as const, message: "Service needed was not found." } }, 404);
    case "SqlError":
      return c.json({ error: { code: "SERVICE_NEEDED_REPO_ERROR" as const, message: "Unable to process service needed request." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const serviceNeededErrorToResponse = (c: HonoContext<HonoEnv>, error: ServiceNeededRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "RequestValidationError":
      return requestValidationErrorToResponse(c, error);
    case "ServiceCatalogueItemNotFoundError":
      return c.json(
        { error: { code: "SERVICE_CATALOGUE_ITEM_NOT_FOUND" as const, message: "Service catalogue item was not found." } },
        404,
      );
    case "ServiceCatalogueItemHiddenError":
      return c.json(
        {
          error: {
            code: "SERVICE_CATALOGUE_ITEM_HIDDEN" as const,
            message: "This service is no longer available in the catalogue and can't be newly added.",
          },
        },
        422,
      );
    case "ServicesNeededLimitReachedError":
      return c.json(
        {
          error: {
            code: "SERVICES_NEEDED_LIMIT_REACHED" as const,
            message: `You can list up to ${error.max} services — remove one to add another.`,
            max: error.max,
          },
        },
        422,
      );
    case "DBNotFoundError":
    case "SqlError":
      return repoErrorToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ServiceNeededRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return serviceNeededErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    },
  });

export async function listServicesNeededHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    listServicesNeededRouteProgram(headers),
  );

  return exitToResponse(c, exit);
}

export async function createServiceNeededHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(
    createServiceNeededRouteProgram(c, headers),
  );

  return exitToResponse(c, exit);
}

export async function updateServiceNeededHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const serviceId = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    updateServiceNeededRouteProgram(c, headers, serviceId),
  );

  return exitToResponse(c, exit);
}

export async function deleteServiceNeededHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const serviceId = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(
    deleteServiceNeededRouteProgram(headers, serviceId),
  );

  return exitToResponse(c, exit);
}
