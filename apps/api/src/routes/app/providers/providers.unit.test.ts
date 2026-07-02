import { DBNotFoundError, makeSessionRepoTest, makeUserProfileRepoTest, makeUserRepoTest, type Session, type User } from "@repo/db";
import { makeProviderSearchIndexTest, type ProviderSearchDocument } from "@repo/typesense";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
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

const providerDocument = (): ProviderSearchDocument => ({
  id: "provider-1",
  userId: "provider-1",
  displayName: "Provider User",
  firstName: "Provider",
  lastName: "User",
  shortBio: "Experienced caregiver",
  city: "Toronto",
  stateProvince: "ON",
  country: "CA",
  location: [43.6532, -79.3832],
  services: ["Childcare"],
  serviceDescriptions: ["After-school care"],
  serviceNamesText: "Childcare",
  minHourlyRateCents: 2500,
  maxHourlyRateCents: 2500,
  currencies: ["CAD"],
  approvalExpiresAt: new Date("2027-01-01T00:00:00.000Z").getTime(),
  updatedAt: new Date("2026-06-12T00:00:00.000Z").getTime(),
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: { hasPermission?: boolean; hasLocation?: boolean } = {}) => {
  const currentUser = user();
  const currentSession = session();

  return Layer.mergeAll(
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
    makeProviderSearchIndexTest({
      ensureCollection: () => Effect.void,
      reconcileProvider: () => Effect.void,
      reindexAllProviders: () => Effect.succeed({ indexed: 0, deletedStale: 0 }),
      getProvider: () => Effect.succeed(providerDocument()),
      searchProviders: () => Effect.succeed({ providers: [providerDocument()], pagination: { page: 1, perPage: 20, total: 1 } }),
    }),
  );
};

describe("provider search route program", () => {
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
