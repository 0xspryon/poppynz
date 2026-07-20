import type { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, ServiceCatalogueRepo, type ServiceCatalogueItem } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, isAuthError, requirePermissions } from "@/api/lib/effect-auth";
import { isRequestValidationError, parseJsonBody, requestValidationErrorToResponse } from "@/api/lib/schema-validator";
import {
  serviceCatalogueJsonError,
  validateServiceCatalogueItemCreateInput,
  validateServiceCatalogueItemUpdateInput,
} from "./service-catalogue.validator";

class ServiceCatalogueNotFoundError extends Data.TaggedError("ServiceCatalogueNotFoundError")<{ id: string }> { }
class ServiceCatalogueRepoError extends Data.TaggedError("ServiceCatalogueRepoError")<{ cause: SqlError }> { }

function mapCatalogueRepoError<A, R>(effect: Effect.Effect<A, SqlError, R>): Effect.Effect<A, ServiceCatalogueRepoError, R>;
function mapCatalogueRepoError<A, R>(
  effect: Effect.Effect<A, SqlError | DBNotFoundError, R>,
): Effect.Effect<A, ServiceCatalogueRepoError | ServiceCatalogueNotFoundError, R>;
function mapCatalogueRepoError<A, R>(effect: Effect.Effect<A, SqlError | DBNotFoundError, R>) {
  return effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new ServiceCatalogueRepoError({ cause })),
      DBNotFoundError: (cause) => Effect.fail(new ServiceCatalogueNotFoundError({ id: cause.value })),
    }),
  );
}

const toDateString = (date: Date | null | undefined) => date?.toISOString() ?? null;
export const toCatalogueItemResponse = (item: ServiceCatalogueItem) => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  deletedAt: toDateString(item.deletedAt),
});

export const listLiveServiceCatalogueRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceCatalogue: ["read"] })(authenticated);
    const repo = yield* ServiceCatalogueRepo;
    const items = yield* repo.listLive()
      .pipe((errors) => mapCatalogueRepoError(errors));
    return items.map(toCatalogueItemResponse);
  });

export const listAdminServiceCatalogueRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceCatalogue: ["write"] })(authenticated);
    const repo = yield* ServiceCatalogueRepo;
    const items = yield* repo.listActive()
      .pipe((error) => mapCatalogueRepoError(error));
    return items.map(toCatalogueItemResponse);
  });

export const createServiceCatalogueItemRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceCatalogueJsonError);
    const input = yield* validateServiceCatalogueItemCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceCatalogue: ["write"] })(authenticated);
    const repo = yield* ServiceCatalogueRepo;
    const item = yield* repo.create({
      name: input.name,
      category: input.category,
      baseHourlyRateCents: input.baseHourlyRateCents,
      currency: input.currency ?? "CAD",
      isLive: input.isLive ?? true,
    })
      .pipe((error) => mapCatalogueRepoError(error));
    return toCatalogueItemResponse(item);
  });

export const updateServiceCatalogueItemRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers, id: string) =>
  Effect.gen(function*() {
    const rawBody = yield* parseJsonBody(c, serviceCatalogueJsonError);
    const input = yield* validateServiceCatalogueItemUpdateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceCatalogue: ["write"] })(authenticated);
    const repo = yield* ServiceCatalogueRepo;
    const item = yield* mapCatalogueRepoError(repo.update(id, input));
    return toCatalogueItemResponse(item);
  });

export const deleteServiceCatalogueItemRouteProgram = (headers: Headers, id: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { serviceCatalogue: ["write"] })(authenticated);
    const repo = yield* ServiceCatalogueRepo;
    const item = yield* mapCatalogueRepoError(repo.softDelete(id));
    return toCatalogueItemResponse(item);
  });

export type ServiceCatalogueRouteError =
  | Effect.Effect.Error<ReturnType<typeof listLiveServiceCatalogueRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listAdminServiceCatalogueRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createServiceCatalogueItemRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof updateServiceCatalogueItemRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof deleteServiceCatalogueItemRouteProgram>>;

const serviceCatalogueErrorToResponse = (c: HonoContext<HonoEnv>, error: ServiceCatalogueRouteError) => {
  if (isAuthError(error)) return authErrorToResponse(c, error);
  if (isRequestValidationError(error)) return requestValidationErrorToResponse(c, error);

  switch (error._tag) {
    case "ServiceCatalogueNotFoundError":
      return c.json(
        { error: { code: "SERVICE_CATALOGUE_ITEM_NOT_FOUND" as const, message: "Service catalogue item was not found." } },
        404,
      );
    case "ServiceCatalogueRepoError":
      return c.json(
        { error: { code: "SERVICE_CATALOGUE_REPO_ERROR" as const, message: "Unable to process service catalogue request." } },
        500,
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ServiceCatalogueRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return serviceCatalogueErrorToResponse(c, failure.value);
      }

      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function listLiveServiceCatalogueHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listLiveServiceCatalogueRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function listAdminServiceCatalogueHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(listAdminServiceCatalogueRouteProgram(headers));
  return exitToResponse(c, exit);
}

export async function createServiceCatalogueItemHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createServiceCatalogueItemRouteProgram(c, headers));
  return exitToResponse(c, exit);
}

export async function updateServiceCatalogueItemHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(updateServiceCatalogueItemRouteProgram(c, headers, id));
  return exitToResponse(c, exit);
}

export async function deleteServiceCatalogueItemHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const headers = c.req.raw.headers;
  const id = c.req.param("id") ?? "";
  const exit = await runtime.runPromiseExit(deleteServiceCatalogueItemRouteProgram(headers, id));
  return exitToResponse(c, exit);
}
