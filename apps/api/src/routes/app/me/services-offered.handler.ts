import type { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, ServiceCatalogueRepo, type ServiceCatalogueItem, ServiceOfferedRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";
import { scheduleProviderSearchReconcile } from "@/api/lib/provider-search-jobs";
import { parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import {
  serviceOfferedJsonError,
  validateServiceOfferedCreateInput,
  validateServiceOfferedUpdateInput,
} from "./services-offered.validator";

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);

class ServiceCatalogueItemNotFoundError extends Data.TaggedError("ServiceCatalogueItemNotFoundError")<{ id: string }> { }
class ServiceCatalogueItemHiddenError extends Data.TaggedError("ServiceCatalogueItemHiddenError")<{ id: string }> { }
class ServiceRateBelowFloorError extends Data.TaggedError("ServiceRateBelowFloorError")<{ floorCents: number; currency: string }> { }

// Catch the catalogue repo's DBNotFoundError here so it can't fall through to
// the serviceOffered SERVICE_OFFERED_NOT_FOUND mapping.
const findCatalogueItem = (id: string) =>
  ServiceCatalogueRepo.pipe(
    Effect.flatMap((catalogue) => catalogue.findActiveById(id)),
    Effect.catchTag("DBNotFoundError", () => Effect.fail(new ServiceCatalogueItemNotFoundError({ id }))),
  );

// For a service's EXISTING link: a soft-deleted catalogue item behaves like a
// hidden one (the link stays valid, its floor still applies), so look the item
// up without the deleted filter. New/changed links go through findCatalogueItem.
const findCatalogueItemIncludingDeleted = (id: string) =>
  ServiceCatalogueRepo.pipe(
    Effect.flatMap((catalogue) => catalogue.findById(id)),
    Effect.catchTag("DBNotFoundError", () => Effect.fail(new ServiceCatalogueItemNotFoundError({ id }))),
  );

const ensureRateMeetsFloor = (item: ServiceCatalogueItem, hourlyRateCents: number) =>
  hourlyRateCents >= item.baseHourlyRateCents
    ? Effect.void
    : Effect.fail(new ServiceRateBelowFloorError({ floorCents: item.baseHourlyRateCents, currency: item.currency }));

const ensureItemIsLive = (item: ServiceCatalogueItem) =>
  item.isLive ? Effect.void : Effect.fail(new ServiceCatalogueItemHiddenError({ id: item.id }));

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
    if (input.catalogueServiceId != null) {
      const item = yield* findCatalogueItem(input.catalogueServiceId);
      yield* ensureItemIsLive(item);
      yield* ensureRateMeetsFloor(item, input.hourlyRateCents);
    }
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.create({
      userId: userAndSession.user.id,
      catalogueServiceId: input.catalogueServiceId ?? null,
      name: input.name,
      description: input.description ?? null,
      hourlyRateCents: input.hourlyRateCents,
      currency: input.currency ?? "CAD",
    });
    yield* scheduleProviderSearchReconcile(service.userId);

    return toResponse(service);
  });

export const updateServiceOfferedRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceOfferedJsonError);
    const input = yield* validateServiceOfferedUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["write"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const existing = yield* repo.findByIdForUser(serviceId, userAndSession.user.id);
    // Design rules: rates are re-validated against the CURRENT floor whenever
    // the provider edits the rate or the link; an existing link to a hidden
    // (or soft-deleted) item stays valid, but LINKING to one is rejected.
    // Strict comparisons matter: `undefined` = field absent (keep as-is),
    // explicit `null` = unlink — loose equality conflates the two.
    const effectiveLink = input.catalogueServiceId === undefined ? existing.catalogueServiceId : input.catalogueServiceId;
    if (effectiveLink != null && (input.hourlyRateCents !== undefined || input.catalogueServiceId !== undefined)) {
      const linkChanged = input.catalogueServiceId !== undefined && input.catalogueServiceId !== existing.catalogueServiceId;
      const item = linkChanged
        ? yield* findCatalogueItem(effectiveLink)
        : yield* findCatalogueItemIncludingDeleted(effectiveLink);
      if (linkChanged) {
        yield* ensureItemIsLive(item);
      }
      yield* ensureRateMeetsFloor(item, input.hourlyRateCents ?? existing.hourlyRateCents);
    }
    const service = yield* repo.updateByIdForUser(serviceId, userAndSession.user.id, {
      ...input,
      description: input.description === undefined ? undefined : input.description,
    });
    yield* scheduleProviderSearchReconcile(service.userId);

    return toResponse(service);
  });

export const deleteServiceOfferedRouteProgram = (headers: Headers, serviceId: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { serviceOffered: ["write"] })(authenticated);
    const repo = yield* ServiceOfferedRepo;
    const service = yield* repo.softDeleteByIdForUser(serviceId, userAndSession.user.id);
    yield* scheduleProviderSearchReconcile(service.userId);

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
    case "ServiceRateBelowFloorError":
      return c.json(
        {
          error: {
            code: "SERVICE_RATE_BELOW_FLOOR" as const,
            message: `Hourly rate is below the base rate for this service (${formatCents(error.floorCents)}/hr ${error.currency}).`,
            floorCents: error.floorCents,
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
