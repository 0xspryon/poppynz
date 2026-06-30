import { SqlError } from "@effect/sql/SqlError";
import {
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  makeKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceOfferedRepoTest,
  makeSignupIntentRepoTest,
  makeSessionRepoTest,
  makeUserRepoTest,
  makeUserProfileRepoTest,
  type SignupIntent,
  type User,
  type UserProfile,
  DBNotFoundError,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeObjectStorageTest } from "@repo/objs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import {
  applySignupIntentToUserEffect,
  createProfileAndConsumeSignupIntentEffect,
} from "../../../../lib/auth";
import { makeAuthServiceTest } from "../../../../lib/effect-auth";
import { EmptySigninServiceTest } from "../signin/signin.handler";
import {
  makeSignupServiceTest,
  SignupAuthError,
  type SignupRole,
} from "./signup.handler";

const makeApp = (options: {
  create: Parameters<typeof makeSignupIntentRepoTest>[0]["create"];
  sendSignupLink: (input: { email: string; role: SignupRole; headers: Headers }) => Effect.Effect<void, SignupAuthError>;
  existingUser?: User | null;
}) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      makeSignupIntentRepoTest({
        create: options.create,
        findValidByEmail: () => Effect.succeed(null),
        consumeByEmail: () =>
          Effect.succeed(
            makeSignupIntent({
              email: "user@example.com",
              role: "family",
              language: "en",
              expiresAt: new Date(),
            }),
          ),
      }),
      EmptySigninServiceTest,
      makeSignupServiceTest({ sendSignupLink: options.sendSignupLink }),
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used") }),
      makeUserProfileRepoTest(makeInMemoryUserProfileRepo([])),
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceOfferedRepoTest,
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
      }),
      makeKycDocumentRepoTest({
        findByIdWithType: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" })),
        findByUserId: () => Effect.succeed([]),
        findByUserIdWithTypes: () => Effect.succeed([]),
        submit: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" }) as never),
        updateExpiryDate: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" })),
        approveSubmittedByUserId: () => Effect.succeed([]),
      }),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(null),
        userHasPermission: () => Effect.succeed(false),
      }),
      makeUserRepoTest({
        findById: () => Effect.fail(new DBNotFoundError({ value: '', entity: ''})),
        findByEmail: () => {
          if (options.existingUser) { return Effect.succeed(options.existingUser)}
          return Effect.fail(new DBNotFoundError({ value: '', entity: ''}))
        },
      }),
      makeSessionRepoTest({
        findById: () => Effect.fail(
          new DBNotFoundError({ value: '', entity: ''})
        )
      }),
    ),
  );

  return createApp(runtime);
};

const makeSignupIntent = (input: {
  email: string;
  role: string;
  language: string;
  expiresAt: Date;
}): SignupIntent => ({
  id: "signup-intent-1",
  email: input.email,
  role: input.role,
  language: input.language,
  expiresAt: input.expiresAt,
  consumedAt: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Existing User",
  email: "family@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-06-12T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  isAnonymous: false,
  role: "service-provider",
  banned: false,
  banReason: null,
  banExpires: null,
  phoneNumber: null,
  phoneNumberVerified: null,
  ...overrides,
});

const makeInMemorySignupIntentRepo = (intents: Array<SignupIntent>) => ({
  create: (input: { email: string; role: string; language: string; expiresAt: Date }) => {
    const intent = makeSignupIntent({ ...input, email: input.email.toLowerCase() });
    intents.push(intent);

    return Effect.succeed(intent);
  },
  findValidByEmail: (email: string) =>
    Effect.succeed(
      intents
        .filter(
          (intent) =>
            intent.email === email.toLowerCase() &&
            intent.expiresAt > new Date() &&
            intent.consumedAt === null,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
    ),
  consumeByEmail: (email: string) => {
    const intent = intents.find(
      (intent) =>
        intent.email === email.toLowerCase() &&
        intent.expiresAt > new Date() &&
        intent.consumedAt === null,
    );

    if (!intent) {
      return Effect.succeed(makeSignupIntent({
        email: email.toLowerCase(),
        role: "family",
        language: "en",
        expiresAt: new Date(),
      }));
    }

    intent.consumedAt = new Date();
    return Effect.succeed(intent);
  },
});

const makeInMemoryUserProfileRepo = (profiles: Array<UserProfile>) => ({
  create: (input: { userId: string; language: string }) => {
    const profile = {
      userId: input.userId,
      language: input.language,
      firstName: null,
      lastName: null,
      gender: null,
      phoneNumber: null,
      dateOfBirth: null,
      address: null,
      city: null,
      postalCode: null,
      country: null,
      stateProvince: null,
      shortBio: null,
      googlePlaceId: null,
      latitude: null,
      longitude: null,
    };
    profiles.push(profile);

    return Effect.succeed(profile);
  },
  findByUserId: () => Effect.fail(new DBNotFoundError({ value: '', entity: ''})),
  updateByUserId: () => Effect.fail(new DBNotFoundError({ value: '', entity: ''})),
  updateLocationByUserId: () => Effect.fail(new DBNotFoundError({ value: '', entity: ''})),
});

describe("POST /auth/sign-up", () => {
  it("returns success and uses the detected language", async () => {
    const createdLanguages: Array<string> = [];
    const app = makeApp({
      create: (input) => {
        createdLanguages.push(input.language);
        return Effect.succeed(makeSignupIntent(input));
      },
      sendSignupLink: () => Effect.void,
    });

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "es" },
      body: JSON.stringify({ email: "Provider@Example.com", role: "service-provider" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createdLanguages).toEqual(["es"]);
  });

  it("returns a safe invalid input response", async () => {
    const app = makeApp({
      create: (input) => Effect.succeed(makeSignupIntent(input)),
      sendSignupLink: () => Effect.void,
    });

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", role: "family" }),
    });

    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "INVALID_SIGNUP_INPUT",
        message: "A valid email and role are required.",
      },
    });
    expect(body.error.issues).toEqual([
      expect.objectContaining({ path: ["email"] }),
    ]);
  });

  it("returns a safe signup intent failure response", async () => {
    const app = makeApp({
      create: () => Effect.fail(new SqlError({ message: "db down" })),
      sendSignupLink: () => Effect.void,
    });

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "family@example.com", role: "family" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "SIGNUP_INTENT_FAILED",
        message: "Unable to start signup.",
      },
    });
  });

  it("returns a safe magic-link failure response", async () => {
    const app = makeApp({
      create: (input) => Effect.succeed(makeSignupIntent(input)),
      sendSignupLink: () => Effect.fail(new SignupAuthError({ cause: new Error("auth down") })),
    });

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "family@example.com", role: "family" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "SIGNUP_LINK_FAILED",
        message: "Unable to send signup link.",
      },
    });
  });

  it("returns conflict and does not create a signup intent for an existing user", async () => {
    const createdIntents: Array<unknown> = [];
    const sentLinks: Array<unknown> = [];
    const app = makeApp({
      existingUser: makeUser(),
      create: (input) => {
        createdIntents.push(input);
        return Effect.succeed(makeSignupIntent(input));
      },
      sendSignupLink: (input) => {
        sentLinks.push(input);
        return Effect.void;
      },
    });

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "family@example.com", role: "family" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "USER_ALREADY_EXISTS",
        message: "An account already exists for this email.",
      },
    });
    expect(createdIntents).toEqual([]);
    expect(sentLinks).toEqual([]);
  });

  it("uses signup intent to assign role, create profile, and consume intent", async () => {
    const intents: Array<SignupIntent> = [];
    const profiles: Array<UserProfile> = [];
    const signupIntentRepo = makeInMemorySignupIntentRepo(intents);
    const userProfileRepo = makeInMemoryUserProfileRepo(profiles);
    const app = makeApp({
      create: signupIntentRepo.create,
      sendSignupLink: () => Effect.void,
    });
    const hookLayer = Layer.mergeAll(
      makeSignupIntentRepoTest(signupIntentRepo),
      makeUserProfileRepoTest(userProfileRepo),
    );

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "es" },
      body: JSON.stringify({ email: "Provider@Example.com", role: "service-provider" }),
    });

    expect(res.status).toBe(200);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.consumedAt).toBeNull();

    const userWithRole = await Effect.runPromise(
      applySignupIntentToUserEffect({ id: "user-1", email: "provider@example.com" }).pipe(
        Effect.provide(hookLayer),
      ),
    );

    expect(userWithRole).toEqual({
      id: "user-1",
      email: "provider@example.com",
      role: "service-provider",
    });

    await Effect.runPromise(
      createProfileAndConsumeSignupIntentEffect({ id: "user-1", email: "provider@example.com" }).pipe(
        Effect.provide(hookLayer),
      ),
    );

    expect(profiles).toEqual([
      {
        userId: "user-1",
        language: "es",
        firstName: null,
        lastName: null,
        gender: null,
        phoneNumber: null,
        dateOfBirth: null,
        address: null,
        city: null,
        postalCode: null,
        country: null,
        stateProvince: null,
        shortBio: null,
        googlePlaceId: null,
        latitude: null,
        longitude: null,
      },
    ]);
    expect(intents[0]?.consumedAt).toBeInstanceOf(Date);
  });

  it("creates family profiles without creating approvals", async () => {
    const intents: Array<SignupIntent> = [];
    const profiles: Array<UserProfile> = [];
    const signupIntentRepo = makeInMemorySignupIntentRepo(intents);
    const userProfileRepo = makeInMemoryUserProfileRepo(profiles);
    const app = makeApp({
      create: signupIntentRepo.create,
      sendSignupLink: () => Effect.void,
    });
    const hookLayer = Layer.mergeAll(
      makeSignupIntentRepoTest(signupIntentRepo),
      makeUserProfileRepoTest(userProfileRepo),
    );

    const res = await app.request("/app/api/v1/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: JSON.stringify({ email: "Family@Example.com", role: "family" }),
    });

    expect(res.status).toBe(200);

    await Effect.runPromise(
      createProfileAndConsumeSignupIntentEffect({ id: "user-1", email: "family@example.com" }).pipe(
        Effect.provide(hookLayer),
      ),
    );

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.userId).toBe("user-1");
  });
});
