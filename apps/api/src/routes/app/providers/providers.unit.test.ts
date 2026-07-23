import { DBNotFoundError, makeProviderSearchOutboxRepoTest, makeProviderSearchRepoTest, makeSessionRepoTest, makeUserProfileRepoTest, makeUserRepoTest, type ProviderSearchCandidate, type Session, type User } from "@repo/db";
import { makeObjectStorageTest, ObjectStorageError } from "@repo/objs";
import { makeProviderSearchQueueTest } from "@repo/queue";
import { makeProviderSearchIndexTest, type ProviderSearchDocument } from "@repo/typesense";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import { searchProvidersRouteProgram } from "./providers.handler";

const user = (overrides: Partial<User> = {}): User => ({
  id: "family-1",
  name: "Family User",
  email: "family@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false,
  role: "family",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const session = (): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "family-1",
  impersonatedBy: null,
  activeOrganizationId: null,
});

const providerDocument = (overrides: Partial<ProviderSearchDocument> = {}): ProviderSearchDocument => ({
  id: "provider-1",
  userId: "provider-1",
  displayName: "Provider User",
  firstName: "Provider",
  lastName: "User",
  shortBio: "Experienced caregiver",
  image: "users/provider-1/public/profile-pictures/pic.png",
  city: "Toronto",
  cityNormalized: "toronto",
  stateProvince: "ON",
  country: "CA",
  location: [43.6532, -79.3832],
  services: ["Childcare"],
  servicesNormalized: ["childcare"],
  serviceDescriptions: ["After-school care"],
  serviceNamesText: "Childcare",
  minHourlyRateCents: 2500,
  maxHourlyRateCents: 2500,
  currencies: ["CAD"],
  approvalExpiresAt: new Date("2027-01-01T00:00:00.000Z").getTime(),
  updatedAt: new Date("2026-06-12T00:00:00.000Z").getTime(),
  ...overrides,
});

const candidate = (
  userId = "provider-1",
  overrides: Partial<ProviderSearchCandidate["profile"]> = {},
): ProviderSearchCandidate => ({
  profile: {
    userId,
    language: "en",
    firstName: "Provider",
    lastName: "User",
    gender: null,
    phoneNumber: null,
    dateOfBirth: null,
    address: null,
    city: "Toronto",
    postalCode: null,
    country: "CA",
    stateProvince: "ON",
    shortBio: "Experienced caregiver",
    googlePlaceId: null,
    latitude: 43.6532,
    longitude: -79.3832,
    image: "users/provider-1/public/profile-pictures/pic.png",
    email: "provider@example.com",
    role: "service-provider",
    banned: false,
    banExpires: null,
    ...overrides,
  },
  approval: {
    id: "00000000-0000-7000-8000-000000000001",
    userId,
    approvalRequestId: "00000000-0000-7000-8000-000000000002",
    approvedBy: "admin-1",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    status: "approved",
    reason: null,
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  },
  services: [
    {
      id: "00000000-0000-7000-8000-000000000003",
      userId,
      catalogueServiceId: null,
      name: "Childcare",
      description: "After-school care",
      hourlyRateCents: 2500,
      currency: "CAD",
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z"),
      deletedAt: null,
    },
  ],
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: {
  hasPermission?: boolean;
  hasLocation?: boolean;
  documents?: Array<ProviderSearchDocument>;
  searchPages?: Array<Array<ProviderSearchDocument>>;
  indexTotal?: number;
  candidates?: Array<ProviderSearchCandidate>;
  imageUrlError?: ObjectStorageError;
  reconciledUserIds?: Array<string>;
  cityFacets?: Array<{ value: string; count: number }>;
} = {}) => {
  const currentUser = user();
  const currentSession = session();
  const searchPages = options.searchPages ?? [options.documents ?? [providerDocument()]];
  const indexTotal = options.indexTotal ?? searchPages.flat().length;
  const candidates = options.candidates ?? [candidate()];

  return Layer.mergeAll(
    makeObjectStorageTest({
      ensureBucketExists: () => Effect.void,
      ensurePublicReadBucket: () => Effect.void,
      createPresignedPutUrl: () => Effect.fail(new ObjectStorageError({ operation: "presignPutObject", bucket: "unused", cause: "not used" })),
      createPresignedGetUrl: (input) => options.imageUrlError
        ? Effect.fail(options.imageUrlError)
        : Effect.succeed({ url: `https://files.example.com/${input.bucket}/${input.key}?sig=test`, expiresAt: new Date("2026-06-12T00:05:00.000Z") }),
    }),
    makeAuthServiceTest({
      getSession: () => Effect.succeed({ user: { id: currentUser.id }, session: { id: currentSession.id } }),
      userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
    }),
    makeUserRepoTest({
      findById: (id) => id === currentUser.id ? Effect.succeed(currentUser) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: () => Effect.succeed(currentUser),
    }),
    makeSessionRepoTest({
      findById: (id) => id === currentSession.id ? Effect.succeed(currentSession) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
    }),
    makeUserProfileRepoTest({
      create: (input) => Effect.succeed({ userId: input.userId, language: input.language } as never),
      findByUserId: (userId) => Effect.succeed({
        userId,
        email: currentUser.email,
        role: currentUser.role,
        language: "en",
        firstName: "Family",
        lastName: "User",
        gender: null,
        phoneNumber: null,
        dateOfBirth: null,
        address: null,
        city: "Toronto",
        postalCode: null,
        country: "CA",
        stateProvince: "ON",
        shortBio: null,
        googlePlaceId: null,
        latitude: options.hasLocation === false ? null : 43.6532,
        longitude: options.hasLocation === false ? null : -79.3832,
      }),
      updateByUserId: (id) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: id })),
      updateLocationByUserId: (id) => Effect.fail(new DBNotFoundError({ entity: "userProfile", value: id })),
    }),
    makeProviderSearchRepoTest({
      findCandidateByUserId: (userId) => {
        const found = candidates.find((entry) => entry.profile.userId === userId);
        return found ? Effect.succeed(found) : Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
      },
      listCandidatesByUserIds: (userIds) => Effect.succeed(candidates.filter((entry) => userIds.includes(entry.profile.userId))),
      listServiceProviderUserIds: () => Effect.succeed(candidates.map((entry) => entry.profile.userId)),
    }),
    makeProviderSearchOutboxRepoTest({
      createPending: (userId) => Effect.succeed({ id: `outbox-${userId}` } as never),
      listUnresolved: () => Effect.succeed([]),
      markProcessing: (id) => Effect.fail(new DBNotFoundError({ entity: "providerSearchOutbox", value: id })),
      markProcessed: (id) => Effect.fail(new DBNotFoundError({ entity: "providerSearchOutbox", value: id })),
      markFailed: (id) => Effect.fail(new DBNotFoundError({ entity: "providerSearchOutbox", value: id })),
      markSupersededBefore: () => Effect.succeed(0),
    }),
    makeProviderSearchQueueTest({
      enqueueReconcile: (input) => {
        options.reconciledUserIds?.push(input.userId);
        return Effect.succeed({ id: "job-1", name: "reconcile-provider" });
      },
      enqueueReindex: () => Effect.succeed({ id: "job-3", name: "reindex-all-providers" }),
    }),
    makeProviderSearchIndexTest({
      ensureCollection: () => Effect.void,
      reconcileProvider: () => Effect.void,
      reindexAllProviders: () => Effect.succeed({ indexed: 0, deletedStale: 0 }),
      getProvider: () => Effect.succeed(searchPages[0]?.[0] ?? providerDocument()),
      searchProviders: (input) => Effect.succeed({
        providers: searchPages[input.page - 1] ?? [],
        pagination: { page: input.page, perPage: input.perPage, total: indexTotal },
      }),
      listCityFacets: () => Effect.succeed(options.cityFacets ?? []),
    }),
  );
};

describe("provider search route program", () => {
  beforeEach(() => {
    process.env.OBJS_KYC_BUCKET = "kyc-documents";
    process.env.OBJS_PUBLIC_BUCKET = "public-assets";
  });

  it("returns public provider search results", async () => {
    const result = await Effect.runPromise(searchProvidersRouteProgram(new Headers(), { q: "childcare" }).pipe(Effect.provide(makeLayer())));

    expect(result.providers).toEqual([
      expect.objectContaining({
        userId: "provider-1",
        location: { city: "Toronto", stateProvince: "ON", country: "CA" },
      }),
    ]);
    expect(result.providers[0]).not.toHaveProperty("location.location");
  });

  it("returns city facet options for the filter dropdown", async () => {
    const cityFacets = [
      { value: "Mississauga", count: 3 },
      { value: "Port Credit", count: 1 },
    ];
    const result = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer({ cityFacets }))),
    );

    expect(result.facets.city).toEqual(cityFacets);
  });

  it("replaces the stored image key with a presigned URL", async () => {
    const result = await Effect.runPromise(searchProvidersRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer())));

    expect(result.providers[0]?.image).toBe(
      "https://files.example.com/public-assets/users/provider-1/public/profile-pictures/pic.png?sig=test",
    );
  });

  it("returns a null image for providers without a profile picture", async () => {
    const result = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ candidates: [candidate("provider-1", { image: null })] })),
      ),
    );

    expect(result.providers[0]?.image).toBeNull();
  });

  it("serves current database values instead of stale index values", async () => {
    const result = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({
          documents: [providerDocument({ displayName: "Stale Name", firstName: "Stale", lastName: "Name", shortBio: "Stale bio" })],
          candidates: [candidate()],
        })),
      ),
    );

    expect(result.providers[0]?.displayName).toBe("Provider User");
    expect(result.providers[0]?.shortBio).toBe("Experienced caregiver");
  });

  it("drops index hits the database no longer considers eligible and schedules their reconcile", async () => {
    const reconciledUserIds: Array<string> = [];
    const result = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({
          documents: [
            providerDocument(),
            providerDocument({ id: "provider-2", userId: "provider-2" }),
            providerDocument({ id: "provider-3", userId: "provider-3" }),
          ],
          candidates: [
            candidate(),
            candidate("provider-2", { banned: true, banExpires: null }),
            // provider-3 has no candidate at all (deleted user).
          ],
          reconciledUserIds,
        })),
      ),
    );

    expect(result.providers.map((provider) => provider.userId)).toEqual(["provider-1"]);
    expect(result.pagination.total).toBe(1);
    expect(reconciledUserIds.sort()).toEqual(["provider-2", "provider-3"]);
  });

  it("backfills the page from later index pages when candidates are stale", async () => {
    const reconciledUserIds: Array<string> = [];
    // perPage=2 -> the handler fetches candidate pages of 4. Page one is
    // entirely stale, so it must fetch index page two to fill the result page.
    const stale = (id: string) => providerDocument({ id, userId: id });
    const result = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), { perPage: "2" }).pipe(
        Effect.provide(makeLayer({
          searchPages: [
            [stale("stale-1"), stale("stale-2"), stale("stale-3"), stale("stale-4")],
            [providerDocument({ id: "provider-5", userId: "provider-5" })],
          ],
          indexTotal: 5,
          candidates: [candidate("provider-5")],
          reconciledUserIds,
        })),
      ),
    );

    expect(result.providers.map((provider) => provider.userId)).toEqual(["provider-5"]);
    expect(result.pagination.total).toBe(1);
    expect(reconciledUserIds).toHaveLength(4);
  });

  it("translates image presign failures to ProfileImageUrlError", async () => {
    const exit = await Effect.runPromise(
      searchProvidersRouteProgram(new Headers(), {}).pipe(
        Effect.provide(makeLayer({ imageUrlError: new ObjectStorageError({ operation: "presignGetObject", bucket: "public-assets", cause: "down" }) })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("ProfileImageUrlError");
  });

  it("rejects lat/lng query parameters", async () => {
    const exit = await Effect.runPromise(searchProvidersRouteProgram(new Headers(), { lat: "43", lng: "-79" }).pipe(Effect.provide(makeLayer()), Effect.exit));

    expect(getFailure(exit)._tag).toBe("ProviderSearchRequestValidationError");
  });

  it("requires saved user location for radius search", async () => {
    const exit = await Effect.runPromise(searchProvidersRouteProgram(new Headers(), { radiusKm: "10" }).pipe(Effect.provide(makeLayer({ hasLocation: false })), Effect.exit));

    expect(getFailure(exit)._tag).toBe("ProviderSearchRequestValidationError");
  });

  it("requires provider search read permission", async () => {
    const exit = await Effect.runPromise(searchProvidersRouteProgram(new Headers(), {}).pipe(Effect.provide(makeLayer({ hasPermission: false })), Effect.exit));

    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });
});
