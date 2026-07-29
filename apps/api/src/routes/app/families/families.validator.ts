import { Data, Effect } from "effect";

export type FamilySearchSort = "relevance" | "distance" | "newest";

export type FamilySearchQueryInput = {
  q?: string;
  city?: string;
  service?: string;
  radiusKm?: number;
  page: number;
  perPage: number;
  sort: FamilySearchSort;
};

export class FamilySearchRequestValidationError extends Data.TaggedError("FamilySearchRequestValidationError")<{ message: string }> { }

const sortValues = new Set<FamilySearchSort>(["relevance", "distance", "newest"]);

const optionalNumber = (value: string | undefined, name: string) => {
  if (value === undefined || value === "") return Effect.succeed(undefined);
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Effect.succeed(parsed)
    : Effect.fail(new FamilySearchRequestValidationError({ message: `${name} must be a number.` }));
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
    return Effect.fail(new FamilySearchRequestValidationError({ message: `${name} must be a positive integer.` }));
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return Effect.fail(new FamilySearchRequestValidationError({ message: `${name} must be a positive integer.` }));
  }
  if (parsed > max) {
    return Effect.fail(new FamilySearchRequestValidationError({ message: `${name} must be ${max} or less.` }));
  }
  return Effect.succeed(parsed);
};

const sortParam = (value: string | undefined) => {
  if (value === undefined || value === "") return Effect.succeed("relevance" as const);
  return sortValues.has(value as FamilySearchSort)
    ? Effect.succeed(value as FamilySearchSort)
    : Effect.fail(new FamilySearchRequestValidationError({ message: "sort is not supported." }));
};

export const validateFamilySearchQuery = (query: Record<string, string | undefined>) =>
  Effect.gen(function*() {
    if (query.lat !== undefined || query.lng !== undefined) {
      return yield* Effect.fail(new FamilySearchRequestValidationError({ message: "lat and lng query parameters are not supported." }));
    }

    const [page, perPage, radiusKm, sort] = yield* Effect.all([
      boundedPositiveInteger(query.page, "page", 1, MAX_PAGE),
      boundedPositiveInteger(query.perPage, "perPage", 20, MAX_PER_PAGE),
      optionalNumber(query.radiusKm, "radiusKm"),
      sortParam(query.sort),
    ]);

    if (sort === "distance" && radiusKm === undefined) {
      return yield* Effect.fail(new FamilySearchRequestValidationError({ message: "sort=distance requires radiusKm." }));
    }

    return {
      q: query.q,
      city: query.city,
      service: query.service,
      radiusKm,
      page,
      perPage,
      sort,
    };
  });
