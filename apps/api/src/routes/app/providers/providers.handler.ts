import { ProviderSearchIndex } from "@repo/typesense";
import { UserProfileRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "@/api/app-env";
import { authErrorToResponse, authenticate, handleNever, requirePermissions } from "@/api/lib/effect-auth";

class ProviderSearchRequestValidationError extends Data.TaggedError("ProviderSearchRequestValidationError")<{ message: string }> { }

const numberParam = (value: string | undefined, name: string) => {
  if (value === undefined || value === "") return Effect.succeed(undefined);
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Effect.succeed(parsed)
    : Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a number.` }));
};

const integerParam = (value: string | undefined, name: string, defaultValue: number) => {
  if (value === undefined || value === "") return Effect.succeed(defaultValue);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Effect.succeed(parsed)
    : Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a positive integer.` }));
};

const publicProvider = (provider: {
  userId: string;
  displayName: string | null;
  shortBio: string | null;
  city: string;
  stateProvince: string;
  country: string | null;
  services: Array<string>;
  serviceDescriptions: Array<string>;
  minHourlyRateCents: number;
  maxHourlyRateCents: number;
  currencies: Array<string>;
  distanceKm?: number;
}) => ({
  userId: provider.userId,
  displayName: provider.displayName,
  shortBio: provider.shortBio,
  location: {
    city: provider.city,
    stateProvince: provider.stateProvince,
    country: provider.country,
  },
  services: provider.services,
  serviceDescriptions: provider.serviceDescriptions,
  minHourlyRateCents: provider.minHourlyRateCents,
  maxHourlyRateCents: provider.maxHourlyRateCents,
  currencies: provider.currencies,
  distanceKm: provider.distanceKm,
});

export const searchProvidersRouteProgram = (headers: Headers, query: Record<string, string | undefined>) =>
  Effect.gen(function*() {
    if (query.lat !== undefined || query.lng !== undefined) {
      return yield* Effect.fail(new ProviderSearchRequestValidationError({ message: "lat and lng query parameters are not supported." }));
    }

    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { providerSearch: ["read"] })(authenticated);
    const [page, perPage, radiusKm, minHourlyRateCents, maxHourlyRateCents] = yield* Effect.all([
      integerParam(query.page, "page", 1),
      integerParam(query.perPage, "perPage", 20),
      numberParam(query.radiusKm, "radiusKm"),
      numberParam(query.minHourlyRateCents, "minHourlyRateCents"),
      numberParam(query.maxHourlyRateCents, "maxHourlyRateCents"),
    ]);
    const minRadiusKm = Number.parseInt(process.env.PROVIDER_SEARCH_MIN_RADIUS_KM ?? "10", 10);

    let center: [number, number] | undefined;
    if (radiusKm !== undefined) {
      if (radiusKm < minRadiusKm) {
        return yield* Effect.fail(new ProviderSearchRequestValidationError({ message: `radiusKm must be at least ${minRadiusKm}.` }));
      }

      const profileRepo = yield* UserProfileRepo;
      const profile = yield* profileRepo.findByUserId(userAndSession.user.id);
      if (typeof profile.latitude !== "number" || typeof profile.longitude !== "number") {
        return yield* Effect.fail(new ProviderSearchRequestValidationError({ message: "A saved location is required for radius search." }));
      }
      center = [profile.latitude, profile.longitude];
    }

    const index = yield* ProviderSearchIndex;
    const result = yield* index.searchProviders({
      q: query.q,
      city: query.city,
      service: query.service,
      radiusKm,
      center,
      minHourlyRateCents,
      maxHourlyRateCents,
      page,
      perPage,
    });

    return { providers: result.providers.map(publicProvider), pagination: result.pagination };
  });

export const getProviderRouteProgram = (headers: Headers, userId: string) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { providerSearch: ["read"] })(authenticated);
    const index = yield* ProviderSearchIndex;
    const provider = yield* index.getProvider(userId);
    return publicProvider(provider);
  });

type ProvidersRouteError =
  | Effect.Effect.Error<ReturnType<typeof searchProvidersRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof getProviderRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: ProvidersRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "ProviderSearchRequestValidationError":
      return c.json({ error: { code: "INVALID_PROVIDER_SEARCH" as const, message: error.message } }, 400);
    case "ProviderSearchIndexError":
      return c.json({ error: { code: "PROVIDER_SEARCH_FAILED" as const, message: "Unable to search providers." } }, 502);
    case "DBNotFoundError":
      return c.json({ error: { code: "PROVIDER_NOT_FOUND" as const, message: "Provider was not found." } }, 404);
    case "SqlError":
      return c.json({ error: { code: "PROVIDER_SEARCH_PROFILE_LOOKUP_FAILED" as const, message: "Unable to load search profile." } }, 500);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ProvidersRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json({ error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } }, 500);
    },
  });

export async function searchProvidersHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(searchProvidersRouteProgram(c.req.raw.headers, {
    q: c.req.query("q"),
    city: c.req.query("city"),
    service: c.req.query("service"),
    radiusKm: c.req.query("radiusKm"),
    minHourlyRateCents: c.req.query("minHourlyRateCents"),
    maxHourlyRateCents: c.req.query("maxHourlyRateCents"),
    page: c.req.query("page"),
    perPage: c.req.query("perPage"),
    lat: c.req.query("lat"),
    lng: c.req.query("lng"),
  }));
  return exitToResponse(c, exit);
}

export async function getProviderHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(getProviderRouteProgram(c.req.raw.headers, c.req.param("userId") ?? ""));
  return exitToResponse(c, exit);
}
