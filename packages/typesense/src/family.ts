import { familySearchConfig, typesenseConfig } from "@repo/env";
import { DBNotFoundError, FamilySearchRepo, FamilySearchRepoDefault, type FamilySearchCandidate } from "@repo/db";
import { Cause, Context, Data, Effect, Layer } from "effect";
import Typesense from "typesense";

export type FamilySearchDocument = {
  id: string;
  userId: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  shortBio: string | null;
  // Raw rustfs file key of the profile picture — never expose it directly;
  // the API swaps it for a presigned URL at response time.
  image?: string;
  city: string;
  cityNormalized: string;
  stateProvince: string;
  country: string | null;
  location: [number, number];
  services: Array<string>;
  servicesNormalized: Array<string>;
  serviceDescriptions: Array<string>;
  serviceNamesText: string;
  updatedAt: number;
};

export type FamilySearchInput = {
  q?: string;
  city?: string;
  service?: string;
  radiusKm?: number;
  center?: [number, number];
  sort?: "relevance" | "distance" | "newest";
  page: number;
  perPage: number;
};

export type FamilySearchResult = {
  families: Array<FamilySearchDocument & { distanceKm?: number }>;
  pagination: { page: number; perPage: number; total: number };
};

export type FamilyCityFacet = { value: string; count: number };

export class FamilySearchIndexError extends Data.TaggedError("FamilySearchIndexError")<{
  operation: "ensureCollection" | "upsert" | "delete" | "search" | "get" | "reindex" | "listDocuments";
  cause: unknown;
}> { }

export class FamilySearchIndex extends Context.Tag("@repo/typesense/FamilySearchIndex")<
  FamilySearchIndex,
  {
    ensureCollection: () => Effect.Effect<void, FamilySearchIndexError>;
    reconcileFamily: (userId: string) => Effect.Effect<void, FamilySearchIndexError>;
    searchFamilies: (input: FamilySearchInput) => Effect.Effect<FamilySearchResult, FamilySearchIndexError>;
    listCityFacets: (input: FamilySearchInput) => Effect.Effect<Array<FamilyCityFacet>, FamilySearchIndexError>;
    getFamily: (userId: string) => Effect.Effect<FamilySearchDocument, FamilySearchIndexError | DBNotFoundError>;
    reindexAllFamilies: () => Effect.Effect<{ indexed: number; deletedStale: number }, FamilySearchIndexError>;
  }
>() { }

const isNotFound = (cause: unknown) => {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { httpStatus?: number; status?: number };
  return error.httpStatus === 404 || error.status === 404;
};

const displayName = (firstName: string | null, lastName: string | null) => {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
};

const unique = (values: Array<string>) => Array.from(new Set(values));

/** Matching-side normalization: facet filters compare lowercase against
 * lowercase, while the original-cased fields stay for display. */
const normalizeForMatch = (value: string) => value.trim().toLowerCase();

export const buildFamilySearchDocument = (candidate: FamilySearchCandidate): FamilySearchDocument | null => {
  const { profile, services } = candidate;
  const activeServices = services.filter((service) => service.deletedAt === null);

  if (profile.role !== "family") return null;
  // A ban with no expiry is permanent; an expiry in the past means the ban has lapsed.
  if (profile.banned === true && (profile.banExpires === null || profile.banExpires > new Date())) return null;
  if (typeof profile.latitude !== "number" || typeof profile.longitude !== "number") return null;
  if (!profile.city || !profile.stateProvince) return null;
  if (activeServices.length === 0) return null;

  const servicesNames = activeServices.map((service) => service.name);
  const serviceDescriptions = activeServices
    .map((service) => service.description)
    .filter((description): description is string => Boolean(description));

  return {
    id: profile.userId,
    userId: profile.userId,
    displayName: displayName(profile.firstName, profile.lastName),
    firstName: profile.firstName,
    lastName: profile.lastName,
    shortBio: profile.shortBio,
    ...(profile.image ? { image: profile.image } : {}),
    city: profile.city,
    cityNormalized: normalizeForMatch(profile.city),
    stateProvince: profile.stateProvince,
    country: profile.country,
    location: [profile.latitude, profile.longitude],
    services: servicesNames,
    servicesNormalized: unique(servicesNames.map(normalizeForMatch)),
    serviceDescriptions,
    serviceNamesText: servicesNames.join(" "),
    updatedAt: Date.now(),
  };
};

const toPublicDocument = (document: FamilySearchDocument, distanceKm?: number) => ({
  ...document,
  distanceKm,
});

const collectionSchema = (name: string) => ({
  name,
  fields: [
    { name: "userId", type: "string" as const, facet: false },
    { name: "displayName", type: "string" as const, optional: true },
    { name: "firstName", type: "string" as const, optional: true },
    { name: "lastName", type: "string" as const, optional: true },
    { name: "shortBio", type: "string" as const, optional: true },
    { name: "image", type: "string" as const, optional: true, index: false },
    { name: "city", type: "string" as const, facet: true },
    { name: "cityNormalized", type: "string" as const, facet: true },
    { name: "stateProvince", type: "string" as const, facet: true },
    { name: "country", type: "string" as const, facet: true, optional: true },
    { name: "location", type: "geopoint" as const },
    { name: "services", type: "string[]" as const, facet: true },
    { name: "servicesNormalized", type: "string[]" as const, facet: true },
    { name: "serviceDescriptions", type: "string[]" as const, optional: true },
    { name: "serviceNamesText", type: "string" as const },
    { name: "updatedAt", type: "int64" as const, facet: true },
  ],
  default_sorting_field: "updatedAt",
});

// Wrap a facet value in Typesense's backtick literal syntax so user input
// can't inject filter operators (`||`, `:`, geo predicates). JSON.stringify
// is NOT enough here — it only escapes for JSON, not the filter grammar.
const filterString = (value: string) => `\`${value.replace(/`/g, "\\`")}\``;

export const buildFamilyFilter = (input: FamilySearchInput) => {
  const filters: Array<string> = [];
  if (input.city) filters.push(`cityNormalized:=${filterString(normalizeForMatch(input.city))}`);
  if (input.service) filters.push(`servicesNormalized:=${filterString(normalizeForMatch(input.service))}`);
  if (input.radiusKm && input.center) filters.push(`location:(${input.center[0]}, ${input.center[1]}, ${input.radiusKm} km)`);
  return filters.join(" && ");
};

const distanceFromHit = (hit: { geo_distance_meters?: Record<string, number> }) => {
  const meters = hit.geo_distance_meters?.location;
  // Rounding up to the nearest 0.1KM
  return typeof meters === "number" ? Math.round((meters / 1000) * 10) / 10 : undefined;
};

const chunksOf = <T>(items: Array<T>, size: number) => {
  const chunks: Array<Array<T>> = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const sortBy = (input: FamilySearchInput) => {
  if (input.center && (input.sort === undefined || input.sort === "distance")) return `location(${input.center[0]}, ${input.center[1]}):asc`;
  switch (input.sort) {
    case "newest": return "updatedAt:desc";
    default: return undefined;
  }
};

const queryBy = "displayName,shortBio,services,serviceDescriptions,serviceNamesText,city,stateProvince,country";

const makeFamilySearchIndex = (config: { host: string; port: number; protocol: string; apiKey: string; familyCollection: string; familyCollectionAlias: string; familyCollectionVersion: string }) => {
  const client = new Typesense.Client({
    nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
    apiKey: config.apiKey,
    connectionTimeoutSeconds: 5,
  });

  return Effect.gen(function*() {
    const repo = yield* FamilySearchRepo;
    const writeCollection = config.familyCollectionVersion || config.familyCollection;
    const readCollection = config.familyCollectionAlias || writeCollection;

    const ensureCollection = () =>
      Effect.tryPromise({
        try: async () => {
          try {
            await client.collections(writeCollection).retrieve();
          } catch (cause) {
            if (!isNotFound(cause)) throw cause;
            await client.collections().create(collectionSchema(writeCollection));
          }

          await client.aliases().upsert(readCollection, { collection_name: writeCollection });
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "ensureCollection", cause }),
      });

    const deleteFamily = (userId: string) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await client.collections(writeCollection).documents(userId).delete();
          } catch (cause) {
            if (!isNotFound(cause)) throw cause;
          }
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "delete", cause }),
      });

    const deleteFamilies = (userIds: Array<string>) =>
      Effect.tryPromise({
        try: async () => {
          if (userIds.length === 0) return 0;

          let deleted = 0;

          for (const chunk of chunksOf(userIds, 250)) {
            const response = await client
              .collections(writeCollection)
              .documents()
              .delete({
                filter_by: `id:=[${chunk.map(filterString).join(",")}]`,
                batch_size: 250,
              });

            deleted += response.num_deleted;
          }

          return deleted;
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "delete", cause }),
      });

    const upsertFamily = (document: FamilySearchDocument) =>
      Effect.tryPromise({
        try: () => client.collections(writeCollection).documents().upsert(document),
        catch: (cause) => new FamilySearchIndexError({ operation: "upsert", cause }),
      }).pipe(Effect.asVoid);

    const reconcileFamily = (userId: string) =>
      Effect.gen(function*() {
        yield* ensureCollection();
        const candidate = yield* repo.findCandidateByUserId(userId).pipe(
          Effect.catchTag("DBNotFoundError", () => Effect.succeed(null)),
          Effect.mapError((cause) => new FamilySearchIndexError({ operation: "get", cause })),
        );
        const document = candidate ? buildFamilySearchDocument(candidate) : null;

        if (!document) {
          yield* deleteFamily(userId);
          return;
        }

        yield* upsertFamily(document);
      });

    const searchFamilies = (input: FamilySearchInput) =>
      Effect.tryPromise({
        try: async () => {
          const searchParams = {
            q: input.q?.trim() || "*",
            query_by: queryBy,
            filter_by: buildFamilyFilter(input),
            page: input.page,
            per_page: input.perPage,
            ...(sortBy(input) ? { sort_by: sortBy(input) } : {}),
          };
          const response = await client.collections(readCollection).documents().search(searchParams);
          const hits = (response.hits ?? []) as Array<{ document: FamilySearchDocument; geo_distance_meters?: Record<string, number> }>;

          return {
            families: hits.map((hit) => toPublicDocument(hit.document, distanceFromHit(hit))),
            pagination: { page: input.page, perPage: input.perPage, total: response.found ?? 0 },
          };
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "search", cause }),
      });

    const listCityFacets = (input: FamilySearchInput) =>
      Effect.tryPromise({
        try: async () => {
          const response = await client.collections(readCollection).documents().search({
            q: input.q?.trim() || "*",
            query_by: queryBy,
            // Drop the city AND geo clauses: the dropdown must list every city
            // with families (not just those inside the current radius) so it
            // can act as a "jump to this place" control, and selecting a city
            // must not collapse the list to that one option. Other filters
            // (q, service) still scope the counts.
            filter_by: buildFamilyFilter({ ...input, city: undefined, radiusKm: undefined, center: undefined }),
            facet_by: "city",
            max_facet_values: 250,
            per_page: 0,
            page: 1,
          });
          const facet = (response.facet_counts ?? []).find((entry) => entry.field_name === "city");
          const counts = (facet?.counts ?? []) as Array<{ value: string; count: number }>;
          return counts
            .map((entry) => ({ value: entry.value, count: entry.count }))
            .sort((a, b) => a.value.localeCompare(b.value));
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "search", cause }),
      });

    const getFamily = (userId: string) =>
      Effect.tryPromise({
        try: async () => await client.collections(readCollection).documents(userId).retrieve() as FamilySearchDocument,
        catch: (cause) => isNotFound(cause)
          ? new DBNotFoundError({ entity: "familySearchDocument", value: userId })
          : new FamilySearchIndexError({ operation: "get", cause }),
      });

    const listIndexedIds = () =>
      Effect.tryPromise({
        try: async () => {
          const ids: Array<string> = [];
          let page = 1;
          const perPage = 250;

          while (true) {
            const response = await client.collections(writeCollection).documents().search({ q: "*", query_by: "userId", page, per_page: perPage });
            const hits = (response.hits ?? []) as Array<{ document: FamilySearchDocument }>;
            ids.push(...hits.map((hit) => hit.document.userId));

            if (ids.length >= (response.found ?? 0) || hits.length === 0) break;
            page += 1;
          }

          return ids;
        },
        catch: (cause) => new FamilySearchIndexError({ operation: "listDocuments", cause }),
      });

    const reindexAllFamilies = () =>
      Effect.gen(function*() {
        yield* ensureCollection();
        // MVP tradeoff: this loads all family IDs and reconciles each family with
        // bounded concurrency. For larger datasets, paginate IDs and batch/aggregate DB reads.
        const userIds = yield* repo.listFamilyUserIds().pipe(
          Effect.mapError((cause) => new FamilySearchIndexError({ operation: "reindex", cause })),
        );
        let indexed = 0;
        const eligibleIds = new Set<string>();

        yield* Effect.forEach(
          userIds,
          (userId) =>
            Effect.gen(function*() {
              const candidate = yield* repo.findCandidateByUserId(userId).pipe(
                Effect.mapError((cause) => new FamilySearchIndexError({ operation: "reindex", cause })),
              );
              const document = buildFamilySearchDocument(candidate);
              if (!document) return;
              yield* upsertFamily(document);
              eligibleIds.add(userId);
              indexed += 1;
            }),
          { concurrency: 5, discard: true },
        );

        const indexedIds = yield* listIndexedIds();
        const staleIds = indexedIds.filter((id) => !eligibleIds.has(id));
        const deletedStale = yield* deleteFamilies(staleIds);

        return { indexed, deletedStale };
      }).pipe(
        Effect.catchAllCause((cause) => Effect.fail(new FamilySearchIndexError({ operation: "reindex", cause: Cause.pretty(cause) }))),
      );

    return { ensureCollection, reconcileFamily, searchFamilies, listCityFacets, getFamily, reindexAllFamilies };
  });
};

export const FamilySearchIndexLive = Layer.effect(
  FamilySearchIndex,
  typesenseConfig.pipe(Effect.flatMap(makeFamilySearchIndex)),
);

export const FamilySearchIndexDefault = FamilySearchIndexLive.pipe(Layer.provide(FamilySearchRepoDefault));

export const makeFamilySearchIndexTest = (implementation: Context.Tag.Service<FamilySearchIndex>) =>
  Layer.succeed(FamilySearchIndex, implementation);

export const getFamilySearchMinRadiusKm = familySearchConfig.pipe(Effect.map((config) => config.minRadiusKm));
