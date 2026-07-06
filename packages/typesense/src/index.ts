import { providerSearchConfig, typesenseConfig } from "@repo/env";
import { DBNotFoundError, ProviderSearchRepo, ProviderSearchRepoDefault, type ProviderSearchCandidate } from "@repo/db";
import { Cause, Context, Data, Effect, Layer } from "effect";
import Typesense from "typesense";

export type ProviderSearchDocument = {
  id: string;
  userId: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  shortBio: string | null;
  city: string;
  stateProvince: string;
  country: string | null;
  location: [number, number];
  services: Array<string>;
  serviceDescriptions: Array<string>;
  serviceNamesText: string;
  minHourlyRateCents: number;
  maxHourlyRateCents: number;
  currencies: Array<string>;
  approvalExpiresAt: number;
  updatedAt: number;
};

export type ProviderSearchInput = {
  q?: string;
  city?: string;
  service?: string;
  radiusKm?: number;
  center?: [number, number];
  minHourlyRateCents?: number;
  maxHourlyRateCents?: number;
  sort?: "relevance" | "distance" | "price_asc" | "price_desc" | "newest";
  page: number;
  perPage: number;
};

export type ProviderSearchResult = {
  providers: Array<ProviderSearchDocument & { distanceKm?: number }>;
  pagination: { page: number; perPage: number; total: number };
};

export class ProviderSearchIndexError extends Data.TaggedError("ProviderSearchIndexError")<{
  operation: "ensureCollection" | "upsert" | "delete" | "search" | "get" | "reindex" | "listDocuments";
  cause: unknown;
}> { }

export class ProviderSearchValidationError extends Data.TaggedError("ProviderSearchValidationError")<{
  message: string;
}> { }

export class ProviderSearchIndex extends Context.Tag("@repo/typesense/ProviderSearchIndex")<
  ProviderSearchIndex,
  {
    ensureCollection: () => Effect.Effect<void, ProviderSearchIndexError>;
    reconcileProvider: (userId: string) => Effect.Effect<void, ProviderSearchIndexError>;
    searchProviders: (input: ProviderSearchInput) => Effect.Effect<ProviderSearchResult, ProviderSearchIndexError>;
    getProvider: (userId: string) => Effect.Effect<ProviderSearchDocument, ProviderSearchIndexError | DBNotFoundError>;
    reindexAllProviders: () => Effect.Effect<{ indexed: number; deletedStale: number }, ProviderSearchIndexError>;
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

export const buildProviderSearchDocument = (candidate: ProviderSearchCandidate): ProviderSearchDocument | null => {
  const { profile, approval, services } = candidate;
  const activeServices = services.filter((service) => service.deletedAt === null);

  if (profile.role !== "service-provider") return null;
  if (!approval || approval.expiresAt <= new Date()) return null;
  if (typeof profile.latitude !== "number" || typeof profile.longitude !== "number") return null;
  if (!profile.city || !profile.stateProvince) return null;
  if (activeServices.length === 0) return null;

  const rates = activeServices.map((service) => service.hourlyRateCents);
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
    city: profile.city,
    stateProvince: profile.stateProvince,
    country: profile.country,
    location: [profile.latitude, profile.longitude],
    services: servicesNames,
    serviceDescriptions,
    serviceNamesText: servicesNames.join(" "),
    minHourlyRateCents: Math.min(...rates),
    maxHourlyRateCents: Math.max(...rates),
    currencies: unique(activeServices.map((service) => service.currency)),
    approvalExpiresAt: approval.expiresAt.getTime(),
    updatedAt: Date.now(),
  };
};

const toPublicDocument = (document: ProviderSearchDocument, distanceKm?: number) => ({
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
    { name: "city", type: "string" as const, facet: true },
    { name: "stateProvince", type: "string" as const, facet: true },
    { name: "country", type: "string" as const, facet: true, optional: true },
    { name: "location", type: "geopoint" as const },
    { name: "services", type: "string[]" as const, facet: true },
    { name: "serviceDescriptions", type: "string[]" as const, optional: true },
    { name: "serviceNamesText", type: "string" as const },
    { name: "minHourlyRateCents", type: "int32" as const, facet: true },
    { name: "maxHourlyRateCents", type: "int32" as const, facet: true },
    { name: "currencies", type: "string[]" as const, facet: true },
    { name: "approvalExpiresAt", type: "int64" as const, facet: true },
    { name: "updatedAt", type: "int64" as const, facet: true },
  ],
  default_sorting_field: "updatedAt",
});

const buildFilter = (input: ProviderSearchInput) => {
  const filters = [`approvalExpiresAt:>${Date.now()}`];
  if (input.city) filters.push(`city:=${JSON.stringify(input.city)}`);
  if (input.service) filters.push(`services:=${JSON.stringify(input.service)}`);
  if (typeof input.minHourlyRateCents === "number") filters.push(`maxHourlyRateCents:>=${input.minHourlyRateCents}`);
  if (typeof input.maxHourlyRateCents === "number") filters.push(`minHourlyRateCents:<=${input.maxHourlyRateCents}`);
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

const filterString = (value: string) => `\`${value.replace(/`/g, "\\`")}\``;

const sortBy = (input: ProviderSearchInput) => {
  if (input.center && (input.sort === undefined || input.sort === "distance")) return `location(${input.center[0]}, ${input.center[1]}):asc`;
  switch (input.sort) {
    case "price_asc": return "minHourlyRateCents:asc";
    case "price_desc": return "minHourlyRateCents:desc";
    case "newest": return "updatedAt:desc";
    default: return undefined;
  }
};

const makeProviderSearchIndex = (config: { host: string; port: number; protocol: string; apiKey: string; providerCollection: string; providerCollectionAlias: string; providerCollectionVersion: string }) => {
  const client = new Typesense.Client({
    nodes: [{ host: config.host, port: config.port, protocol: config.protocol }],
    apiKey: config.apiKey,
    connectionTimeoutSeconds: 5,
  });

  return Effect.gen(function*() {
    const repo = yield* ProviderSearchRepo;
    const writeCollection = config.providerCollectionVersion || config.providerCollection;
    const readCollection = config.providerCollectionAlias || writeCollection;

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
        catch: (cause) => new ProviderSearchIndexError({ operation: "ensureCollection", cause }),
      });

    const deleteProvider = (userId: string) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await client.collections(writeCollection).documents(userId).delete();
          } catch (cause) {
            if (!isNotFound(cause)) throw cause;
          }
        },
        catch: (cause) => new ProviderSearchIndexError({ operation: "delete", cause }),
      });

    const deleteProviders = (userIds: Array<string>) =>
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
        catch: (cause) => new ProviderSearchIndexError({ operation: "delete", cause }),
      });

    const upsertProvider = (document: ProviderSearchDocument) =>
      Effect.tryPromise({
        try: () => client.collections(writeCollection).documents().upsert(document),
        catch: (cause) => new ProviderSearchIndexError({ operation: "upsert", cause }),
      }).pipe(Effect.asVoid);

    const reconcileProvider = (userId: string) =>
      Effect.gen(function*() {
        yield* ensureCollection();
        const candidate = yield* repo.findCandidateByUserId(userId).pipe(
          Effect.catchTag("DBNotFoundError", () => Effect.succeed(null)),
          Effect.mapError((cause) => new ProviderSearchIndexError({ operation: "get", cause })),
        );
        const document = candidate ? buildProviderSearchDocument(candidate) : null;

        if (!document) {
          yield* deleteProvider(userId);
          return;
        }

        yield* upsertProvider(document);
      });

    const searchProviders = (input: ProviderSearchInput) =>
      Effect.tryPromise({
        try: async () => {
          const searchParams = {
            q: input.q?.trim() || "*",
            query_by: "displayName,shortBio,services,serviceDescriptions,serviceNamesText,city,stateProvince,country",
            filter_by: buildFilter(input),
            page: input.page,
            per_page: input.perPage,
            ...(sortBy(input) ? { sort_by: sortBy(input) } : {}),
          };
          const response = await client.collections(readCollection).documents().search(searchParams);
          const hits = (response.hits ?? []) as Array<{ document: ProviderSearchDocument; geo_distance_meters?: Record<string, number> }>;

          return {
            providers: hits.map((hit) => toPublicDocument(hit.document, distanceFromHit(hit))),
            pagination: { page: input.page, perPage: input.perPage, total: response.found ?? 0 },
          };
        },
        catch: (cause) => new ProviderSearchIndexError({ operation: "search", cause }),
      });

    const getProvider = (userId: string) =>
      Effect.tryPromise({
        try: async () => {
          const document = await client.collections(readCollection).documents(userId).retrieve() as ProviderSearchDocument;
          if (document.approvalExpiresAt <= Date.now()) throw new DBNotFoundError({ entity: "providerSearchDocument", value: userId });
          return document;
        },
        catch: (cause) => isNotFound(cause)
          ? new DBNotFoundError({ entity: "providerSearchDocument", value: userId })
          : cause instanceof DBNotFoundError
            ? cause
            : new ProviderSearchIndexError({ operation: "get", cause }),
      });

    const listIndexedIds = () =>
      Effect.tryPromise({
        try: async () => {
          const ids: Array<string> = [];
          let page = 1;
          const perPage = 250;

          while (true) {
            const response = await client.collections(writeCollection).documents().search({ q: "*", query_by: "userId", page, per_page: perPage });
            const hits = (response.hits ?? []) as Array<{ document: ProviderSearchDocument }>;
            ids.push(...hits.map((hit) => hit.document.userId));

            if (ids.length >= (response.found ?? 0) || hits.length === 0) break;
            page += 1;
          }

          return ids;
        },
        catch: (cause) => new ProviderSearchIndexError({ operation: "listDocuments", cause }),
      });

    const reindexAllProviders = () =>
      Effect.gen(function*() {
        yield* ensureCollection();
        // MVP tradeoff: this loads all service-provider IDs and reconciles each provider with
        // bounded concurrency. For larger datasets, paginate IDs and batch/aggregate DB reads.
        const userIds = yield* repo.listServiceProviderUserIds().pipe(
          Effect.mapError((cause) => new ProviderSearchIndexError({ operation: "reindex", cause })),
        );
        let indexed = 0;
        const eligibleIds = new Set<string>();

        yield* Effect.forEach(
          userIds,
          (userId) =>
            Effect.gen(function*() {
              const candidate = yield* repo.findCandidateByUserId(userId).pipe(
                Effect.mapError((cause) => new ProviderSearchIndexError({ operation: "reindex", cause })),
              );
              const document = buildProviderSearchDocument(candidate);
              if (!document) return;
              yield* upsertProvider(document);
              eligibleIds.add(userId);
              indexed += 1;
            }),
          { concurrency: 5, discard: true },
        );

        const indexedIds = yield* listIndexedIds();
        const staleIds = indexedIds.filter((id) => !eligibleIds.has(id));
        const deletedStale = yield* deleteProviders(staleIds);

        return { indexed, deletedStale };
      }).pipe(
        Effect.catchAllCause((cause) => Effect.fail(new ProviderSearchIndexError({ operation: "reindex", cause: Cause.pretty(cause) }))),
      );

    return { ensureCollection, reconcileProvider, searchProviders, getProvider, reindexAllProviders };
  });
};

export const ProviderSearchIndexLive = Layer.effect(
  ProviderSearchIndex,
  typesenseConfig.pipe(Effect.flatMap(makeProviderSearchIndex)),
);

export const ProviderSearchIndexDefault = ProviderSearchIndexLive.pipe(Layer.provide(ProviderSearchRepoDefault));

export const makeProviderSearchIndexTest = (implementation: Context.Tag.Service<ProviderSearchIndex>) =>
  Layer.succeed(ProviderSearchIndex, implementation);

export const getProviderSearchMinRadiusKm = providerSearchConfig.pipe(Effect.map((config) => config.minRadiusKm));
