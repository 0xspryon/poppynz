import {
  DBNotFoundError,
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceOfferedRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  type Session,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { makeObjectStorageTest } from "@repo/objs";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../index";
import { makeAuthServiceTest, type AuthSession } from "../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../auth/signin/signin.handler";
import { EmptySignupServiceTest } from "../auth/signup/signup.handler";

const makeUser = (overrides: Partial<User> = {}): User => ({
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
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "session-1",
  expiresAt: new Date("2026-06-13T00:00:00.000Z"),
  token: "session-token",
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ipAddress: null,
  userAgent: null,
  userId: "user-1",
  impersonatedBy: null,
  activeOrganizationId: null,
  ...overrides,
});

const makeApp = (options: { authSession?: AuthSession | null; hasPermission?: boolean; user?: User } = {}) => {
  const user = options.user ?? makeUser();
  const authSession = options.authSession === undefined
    ? { user: { id: user.id }, session: { id: "session-1" } }
    : options.authSession;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      EmptySignupIntentRepoTest,
      EmptySigninServiceTest,
      EmptySignupServiceTest,
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceOfferedRepoTest,
      makeAuthServiceTest({
        getSession: () => Effect.succeed(authSession),
        userHasPermission: () => Effect.succeed(options.hasPermission ?? true),
      }),
      makeUserRepoTest({
        findById: (id) => id === user.id ? Effect.succeed(user) : Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: () => Effect.succeed(user),
      }),
      makeSessionRepoTest({
        findById: (id) => id === "session-1" ? Effect.succeed(makeSession({ userId: user.id })) : Effect.fail(new DBNotFoundError({ entity: "session", value: id })),
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
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
      }),
    ),
  );

  return createApp(runtime);
};

describe("/geocoding/google-place", () => {
  it("returns Google place details for an authenticated user", async () => {
    const app = makeApp();
    const res = await app.request("/app/api/v1/geocoding/google-place?placeId=place-1");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      googlePlaceId: "place-1",
      formattedAddress: "123 Main St, Toronto, ON, Canada",
      city: "Toronto",
      stateProvince: "Ontario",
      stateProvinceCode: "ON",
      country: "Canada",
      countryCode: "CA",
      postalCode: "M5H 1A1",
    });
    expect(body).not.toHaveProperty("latitude");
    expect(body).not.toHaveProperty("longitude");
  });

  it("returns 401 for unauthenticated users", async () => {
    const app = makeApp({ authSession: null });
    const res = await app.request("/app/api/v1/geocoding/google-place?placeId=place-1");

    expect(res.status).toBe(401);
  });

  it("returns 403 when profile read permission is denied", async () => {
    const app = makeApp({ hasPermission: false });
    const res = await app.request("/app/api/v1/geocoding/google-place?placeId=place-1");

    expect(res.status).toBe(403);
  });

  it("returns 400 when placeId is missing", async () => {
    const app = makeApp();
    const res = await app.request("/app/api/v1/geocoding/google-place");

    expect(res.status).toBe(400);
  });
});
