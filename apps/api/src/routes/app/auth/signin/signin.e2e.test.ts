import {
  EmptyApprovalRepoTest,
  EmptyApprovalRequestRepoTest,
  EmptyKycDocumentRepoTest,
  EmptyKycDocumentTypeRepoTest,
  EmptyServiceOfferedRepoTest,
  EmptySignupIntentRepoTest,
  EmptyUserProfileRepoTest,
  DBNotFoundError,
  makeSessionRepoTest,
  makeUserRepoTest,
  type User,
} from "@repo/db";
import { makeGooglePlacesTest } from "@repo/google";
import { makeObjectStorageTest } from "@repo/objs";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../index";
import { makeAuthServiceTest } from "../../../../lib/effect-auth";
import { EmptySignupServiceTest } from "../signup/signup.handler";
import { makeSigninServiceTest, SigninAuthError } from "./signin.handler";

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  name: "Existing User",
  email: "user@example.com",
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

const makeApp = (options: {
  existingUser?: User | null;
  sendSigninLink?: (input: { email: string; headers: Headers }) => Effect.Effect<void, SigninAuthError>;
} = {}) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      EmptySignupIntentRepoTest,
      EmptySignupServiceTest,
      makeSigninServiceTest({ sendSigninLink: options.sendSigninLink ?? (() => Effect.void) }),
      EmptyUserProfileRepoTest,
      EmptyApprovalRepoTest,
      EmptyApprovalRequestRepoTest,
      EmptyKycDocumentRepoTest,
      EmptyKycDocumentTypeRepoTest,
      EmptyServiceOfferedRepoTest,
      makeGooglePlacesTest({ lookupPlaceById: () => Effect.die("not used"), autocompletePlaces: () => Effect.succeed([]) }),
      makeAuthServiceTest({
        getSession: () => Effect.succeed(null),
        userHasPermission: () => Effect.succeed(false),
      }),
      makeUserRepoTest({
        findById: () => Effect.fail(new DBNotFoundError({ entity: "user", value: "user" })),
        findByEmail: (email: string) =>
          options.existingUser === null
            ? Effect.fail(new DBNotFoundError({ entity: "user", value: email.toLowerCase() }))
            : Effect.succeed(options.existingUser ?? makeUser({ email: email.toLowerCase() })),
      }),
      makeSessionRepoTest({
        findById: () => Effect.fail(new DBNotFoundError({ entity: "session", value: "session" })),
      }),
      makeObjectStorageTest({
        ensureBucketExists: () => Effect.void,
        ensurePublicReadBucket: () => Effect.void,
        createPresignedPutUrl: () => Effect.succeed({ uploadUrl: "https://example.com", expiresAt: new Date() }),
        createPresignedGetUrl: () => Effect.succeed({ url: "https://example.com", expiresAt: new Date() }),
      }),
    ),
  );

  return createApp(runtime);
};

describe("POST /auth/sign-in", () => {
  it("returns success and sends a signin link", async () => {
    const sentLinks: Array<{ email: string; headers: Headers }> = [];
    const app = makeApp({
      sendSigninLink: (input) => {
        sentLinks.push(input);
        return Effect.void;
      },
    });

    const res = await app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: " User@Example.com " }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sentLinks).toHaveLength(1);
    expect(sentLinks[0]?.email).toBe("user@example.com");
  });

  it("returns a safe invalid input response", async () => {
    const app = makeApp();

    const res = await app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "INVALID_SIGNIN_INPUT",
        message: "A valid email is required.",
      },
    });
  });

  it("returns 404 and does not send a link for a missing user", async () => {
    const sentLinks: Array<unknown> = [];
    const app = makeApp({
      existingUser: null,
      sendSigninLink: (input) => {
        sentLinks.push(input);
        return Effect.void;
      },
    });

    const res = await app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "USER_NOT_FOUND",
        message: "No account exists for this email.",
      },
    });
    expect(sentLinks).toEqual([]);
  });

  it("returns a safe magic-link failure response", async () => {
    const app = makeApp({
      sendSigninLink: () => Effect.fail(new SigninAuthError({ cause: new Error("auth down") })),
    });

    const res = await app.request("/api/v1/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: {
        code: "SIGNIN_LINK_FAILED",
        message: "Unable to send sign-in link.",
      },
    });
  });
});
