import { Data, Effect } from "effect";

export type ProviderSearchSort = "relevance" | "distance" | "price_asc" | "price_desc" | "newest";

export type ProviderSearchQueryInput = {
  q?: string;
  city?: string;
  service?: string;
  radiusKm?: number;
  minHourlyRateCents?: number;
  maxHourlyRateCents?: number;
  page: number;
  perPage: number;
  sort: ProviderSearchSort;
};

export class ProviderSearchRequestValidationError extends Data.TaggedError("ProviderSearchRequestValidationError")<{ message: string }> { }

const sortValues = new Set<ProviderSearchSort>(["relevance", "distance", "price_asc", "price_desc", "newest"]);

const optionalNumber = (value: string | undefined, name: string) => {
  if (value === undefined || value === "") return Effect.succeed(undefined);
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Effect.succeed(parsed)
    : Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a number.` }));
};

// Bounds keep a single request from fanning out into an unbounded number of
// Typesense/PostgreSQL round-trips (the handler over-fetches candidates up to
// page * perPage).
const MAX_PAGE = 100;
const MAX_PER_PAGE = 50;

const boundedPositiveInteger = (value: string | undefined, name: string, defaultValue: number, max: number) => {
  if (value === undefined || value === "") return Effect.succeed(defaultValue);
  // Reject trailing garbage ("5x") that Number.parseInt would silently accept.
  if (!/^\d+$/.test(value.trim())) {
    return Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a positive integer.` }));
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a positive integer.` }));
  }
  if (parsed > max) {
    return Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be ${max} or less.` }));
  }
  return Effect.succeed(parsed);
};

const sortParam = (value: string | undefined) => {
  if (value === undefined || value === "") return Effect.succeed("relevance" as const);
  return sortValues.has(value as ProviderSearchSort)
    ? Effect.succeed(value as ProviderSearchSort)
    : Effect.fail(new ProviderSearchRequestValidationError({ message: "sort is not supported." }));
};

export const validateProviderSearchQuery = (query: Record<string, string | undefined>) =>
  Effect.gen(function*() {
    if (query.lat !== undefined || query.lng !== undefined) {
      return yield* Effect.fail(new ProviderSearchRequestValidationError({ message: "lat and lng query parameters are not supported." }));
    }

    const [page, perPage, radiusKm, minHourlyRateCents, maxHourlyRateCents, sort] = yield* Effect.all([
      boundedPositiveInteger(query.page, "page", 1, MAX_PAGE),
      boundedPositiveInteger(query.perPage, "perPage", 20, MAX_PER_PAGE),
      optionalNumber(query.radiusKm, "radiusKm"),
      optionalNumber(query.minHourlyRateCents, "minHourlyRateCents"),
      optionalNumber(query.maxHourlyRateCents, "maxHourlyRateCents"),
      sortParam(query.sort),
    ]);

    if (sort === "distance" && radiusKm === undefined) {
      return yield* Effect.fail(new ProviderSearchRequestValidationError({ message: "sort=distance requires radiusKm." }));
    }

    return {
      q: query.q,
      city: query.city,
      service: query.service,
      radiusKm,
      minHourlyRateCents,
      maxHourlyRateCents,
      page,
      perPage,
      sort,
    };
  });
