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

const positiveInteger = (value: string | undefined, name: string, defaultValue: number) => {
  if (value === undefined || value === "") return Effect.succeed(defaultValue);
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Effect.succeed(parsed)
    : Effect.fail(new ProviderSearchRequestValidationError({ message: `${name} must be a positive integer.` }));
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
      positiveInteger(query.page, "page", 1),
      positiveInteger(query.perPage, "perPage", 20),
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
