import { DBNotFoundError, makeSessionRepoTest, makeUserRepoTest, type Session, type User } from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";
import { makeAuthServiceTest } from "@/api/lib/effect-auth";
import { lookupGooglePlaceProgram } from "./geocoding.handler";

const user = (): User => ({
  id: "user-1",
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
});

const session = (): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "user-1",
  impersonatedBy: null,
  activeOrganizationId: null,
});

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected effect to fail");
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) throw new Error("Expected typed failure");
  return failure.value;
};

const makeLayer = (options: { hasPermission?: boolean } = {}) => {
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
    makeGooglePlacesTest({
      lookupPlaceById: (placeId) => Effect.succeed({
        googlePlaceId: placeId,
        formattedAddress: "123 Main St, Toronto, ON, Canada",
        city: "Toronto",
        stateProvince: "Ontario",
        stateProvinceCode: "ON",
        country: "Canada",
        countryCode: "CA",
        postalCode: "M5H 1A1",
        latitude: 43.6532,
        longitude: -79.3832,
      }),
    }),
  );
};

describe("geocoding route programs", () => {
  it("looks up a Google place for authenticated users", async () => {
    const result = await Effect.runPromise(
      lookupGooglePlaceProgram(new Headers(), { placeId: "place-1" }).pipe(Effect.provide(makeLayer())),
    );

    expect(result).toMatchObject({
      googlePlaceId: "place-1",
      city: "Toronto",
      stateProvinceCode: "ON",
    });
    expect(result).not.toHaveProperty("latitude");
    expect(result).not.toHaveProperty("longitude");
  });

  it("rejects missing place ids", async () => {
    const exit = await Effect.runPromise(
      lookupGooglePlaceProgram(new Headers(), {}).pipe(Effect.provide(makeLayer()), Effect.exit),
    );

    expect(getFailure(exit)._tag).toBe("RequestValidationError");
  });

  it("rejects users without profile read permission", async () => {
    const exit = await Effect.runPromise(
      lookupGooglePlaceProgram(new Headers(), { placeId: "place-1" }).pipe(
        Effect.provide(makeLayer({ hasPermission: false })),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)._tag).toBe("ForbiddenError");
  });
});
