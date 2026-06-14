import {
  makeSignupIntentRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  makeUserProfileRepoTest,
  type SafeUserProfile,
  type Session,
  type SignupIntent,
  type User,
  type UserProfile,
  type UserProfileUpdate,
} from "@repo/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { makeAuthServiceTest, type AuthSession, type Permissions } from "../../../lib/effect-auth";
import { createApp } from "../../../index";
import { makeSignupServiceTest, type SignupRole } from "../auth/signup/signup.handler";

const makeSignupIntent = (): SignupIntent => ({
  id: "signup-intent-1",
  email: "user@example.com",
  role: "family",
  language: "en",
  expiresAt: new Date(),
  consumedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
});

const makeProfile = (overrides: Partial<SafeUserProfile> = {}): SafeUserProfile => ({
  userId: "user-1",
  email: "mom_helper@poppynz.com",
  role: "family",
  language: "en",
  firstName: "Springfield",
  lastName: "Mom Helper",
  gender: "female",
  phoneNumber: "(416)88052",
  dateOfBirth: "1980-05-21",
  address: "123 Main Street",
  city: "Toronto",
  postalCode: "M5H N12",
  country: "Canada",
  stateProvince: "Ontario",
  shortBio: "Mom helper profile",
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Mom Helper",
  email: "mom_helper@poppynz.com",
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

const makeApp = (options: {
  authSession: AuthSession | null;
  hasPermission?: boolean;
  user?: User | null;
  session?: Session | null;
  profile: SafeUserProfile;
  onUpdate?: (input: UserProfileUpdate) => void;
  onPermissionCheck?: (permissions: Permissions) => void;
}) => {
  let profile = options.profile;
  const user = options.user === undefined ? makeUser({ id: profile.userId, email: profile.email, role: profile.role }) : options.user;
  const session = options.session === undefined ? makeSession({ userId: profile.userId }) : options.session;
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeSignupIntentRepoTest({
        create: () => Effect.succeed(makeSignupIntent()),
        findValidByEmail: () => Effect.succeed(null),
        consumeByEmail: () => Effect.succeed(makeSignupIntent()),
      }),
      makeSignupServiceTest({
        sendSignupLink: (_: { email: string; role: SignupRole; headers: Headers }) => Effect.void,
      }),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(options.authSession),
        userHasPermission: (_headers: Headers, permissions: Permissions) => {
          options.onPermissionCheck?.(permissions);

          return Effect.succeed(options.hasPermission ?? true);
        },
      }),
      makeUserRepoTest({
        findById: (id: string) => Effect.succeed(user?.id === id ? user : null),
        findByEmail: (email: string) => Effect.succeed(user?.email === email.toLowerCase() ? user : null),
      }),
      makeSessionRepoTest({
        findById: (id: string) => Effect.succeed(session?.id === id ? session : null),
      }),
      makeUserProfileRepoTest({
        create: (input: { userId: string; language: string }) =>
          Effect.succeed({ ...makeProfile(), userId: input.userId, language: input.language } as UserProfile),
        findByUserId: (userId: string) => Effect.succeed(profile.userId === userId ? profile : null),
        updateByUserId: (userId: string, input: UserProfileUpdate) => {
          options.onUpdate?.(input);
          profile = { ...profile, ...input };

          return Effect.succeed(profile.userId === userId ? profile : null);
        },
      }),
    ),
  );

  return createApp(runtime);
};

describe("/me/profile", () => {
  it("returns 401 for unauthenticated requests", async () => {
    const app = makeApp({ authSession: null, profile: makeProfile() });

    const res = await app.request("/app/api/v1/me/profile");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication is required.",
      },
    });
  });

  it("returns 403 when profile read permission is denied", async () => {
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      hasPermission: false,
      profile: makeProfile(),
    });

    const res = await app.request("/app/api/v1/me/profile");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource.",
      },
    });
  });

  it("returns only safe profile fields for family users", async () => {
    const permissionChecks: Array<Permissions> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onPermissionCheck: (permissions) => permissionChecks.push(permissions),
    });

    const res = await app.request("/app/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      userId: "user-1",
      email: "mom_helper@poppynz.com",
      role: "family",
      language: "en",
      firstName: "Springfield",
      lastName: "Mom Helper",
      gender: "female",
      phoneNumber: "(416)88052",
      dateOfBirth: "1980-05-21",
      address: "123 Main Street",
      city: "Toronto",
      postalCode: "M5H N12",
      country: "Canada",
      stateProvince: "Ontario",
      shortBio: "Mom helper profile",
    });
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("newPassword");
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("hourlyRate");
    expect(permissionChecks).toEqual([{ profile: ["read"] }]);
  });

  it("returns profile fields for service-provider users", async () => {
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      user: makeUser({ role: "service-provider" }),
      profile: makeProfile({ role: "service-provider" }),
    });

    const res = await app.request("/app/api/v1/me/profile");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe("service-provider");
  });

  it("does not update email through PATCH", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onUpdate: (input) => updates.push(input),
    });

    const res = await app.request("/app/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", firstName: "Updated" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_PROFILE_INPUT",
        message: "Profile update contains invalid or unsupported fields.",
      },
    });
    expect(updates).toEqual([]);
  });

  it("rejects unsupported gender values", async () => {
    const updates: Array<UserProfileUpdate> = [];
    const app = makeApp({
      authSession: { user: { id: "user-1" }, session: { id: "session-1" } },
      profile: makeProfile(),
      onUpdate: (input) => updates.push(input),
    });

    const res = await app.request("/app/api/v1/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: "other" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_PROFILE_INPUT",
        message: "Profile update contains invalid or unsupported fields.",
      },
    });
    expect(updates).toEqual([]);
  });
});
