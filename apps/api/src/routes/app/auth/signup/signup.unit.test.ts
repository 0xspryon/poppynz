import { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, makeSignupIntentRepoTest, makeUserRepoTest, type SignupIntent, type User } from "@repo/db";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeSignupServiceTest,
  requestSignupProgram,
  SignupAuthError,
  SignupIntentError,
  SignupUserAlreadyExistsError,
  type SignupRole,
} from "./signup.handler";
import { signupInputSchema } from './signup.validator'

const getFailure = <E>(exit: Exit.Exit<unknown, E>) => {
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected effect to fail");
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    throw new Error("Expected typed failure");
  }

  return failure.value;
};

const makeLayer = (options: {
  create: Parameters<typeof makeSignupIntentRepoTest>[0]["create"];
  sendSignupLink: (input: { email: string; role: SignupRole; headers: Headers }) => Effect.Effect<void, SignupAuthError>;
  existingUser?: User | null;
}) =>
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
      makeSignupServiceTest({ sendSignupLink: options.sendSignupLink }),
      makeUserRepoTest({
        findById: (id: string) => Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
        findByEmail: (email: string) =>
          options.existingUser
            ? Effect.succeed(options.existingUser)
            : Effect.fail(new DBNotFoundError({ entity: "user", value: email.toLowerCase() })),
      }),
  );

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
  email: "provider@example.com",
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

describe("requestSignupProgram", () => {
  it("creates a lowercase signup intent and sends a signup link", async () => {
    const createdIntents: Array<{
      email: string;
      role: string;
      language: string;
      expiresAt: Date;
    }> = [];
    const sentLinks: Array<{ email: string; role: SignupRole }> = [];
    const before = Date.now();

    const result = await Effect.runPromise(
      requestSignupProgram(
        signupInputSchema.parse({
           email: "Provider@Example.com",
           role: "service-provider"
        }),
        new Headers(),
        "es"
      )
      .pipe(
        Effect.provide(
          makeLayer({
            create: (input) => {
              createdIntents.push(input);
              return Effect.succeed(makeSignupIntent(input));
            },
            sendSignupLink: ({ email, role }) => {
              sentLinks.push({ email, role });
              return Effect.void;
            },
          }),
        ),
      ),
    );

    expect(result).toEqual({ ok: true });
    expect(createdIntents).toHaveLength(1);
    expect(createdIntents[0]?.email).toBe("provider@example.com");
    expect(createdIntents[0]?.role).toBe("service-provider");
    expect(createdIntents[0]?.language).toBe("es");
    expect(createdIntents[0]?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1_000);
    expect(createdIntents[0]?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1_000);
    expect(sentLinks).toEqual([{ email: "provider@example.com", role: "service-provider" }]);
  });

  it("validates signup input with zod", () => {
    const valid = signupInputSchema.parse(
      { email: " Provider@Example.com ", role: "service-provider" }
    );

    expect(valid).toEqual(
      { email: "provider@example.com", role: "service-provider" }
    );

    const invalidInputs = [
      { role: "family" },
      { email: "not-an-email", role: "family" },
      { email: "family@example.com", role: "admin" },
    ];

    for (const input of invalidInputs) {
      expect(signupInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("protects against punycode emails", () => {
    const valid = signupInputSchema.parse(
      { email: " user@münchen.de ", role: 'service-provider' }
    );

    expect(valid).toEqual({ email: "user@xn--mnchen-3ya.de" });
  });

  it("calls sendSignupLink during signup", async () => {
    const headers = new Headers({ "x-test-header": "test-value" });
    const sendSignupLink = vi.fn(
      (_: { email: string; role: SignupRole; headers: Headers }) => Effect.void
    );

    await Effect.runPromise(
      requestSignupProgram(
        signupInputSchema.parse(
          { email: "Provider@Example.com", role: "service-provider" }
        ),
        headers,
        "en"
      ).pipe(
        Effect.provide(
          makeLayer({
            create: (input) => Effect.succeed(makeSignupIntent(input)),
            sendSignupLink,
          }),
        ),
      ),
    );

    expect(sendSignupLink).toHaveBeenCalledTimes(1);
    expect(sendSignupLink).toHaveBeenCalledWith({
      email: "provider@example.com",
      role: "service-provider",
      headers,
    });
  });

  it("does not create a signup intent when user already exists", async () => {
    const createdIntents: Array<unknown> = [];
    const sentLinks: Array<unknown> = [];
    const exit = await Effect.runPromise(
      requestSignupProgram({ email: "provider@example.com", role: "family" }, new Headers(), "en").pipe(
        Effect.provide(
          makeLayer({
            existingUser: makeUser(),
            create: (input) => {
              createdIntents.push(input);
              return Effect.succeed(makeSignupIntent(input));
            },
            sendSignupLink: (input) => {
              sentLinks.push(input);
              return Effect.void;
            },
          }),
        ),
        Effect.exit,
      ),
    );

    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(SignupUserAlreadyExistsError);
    expect(createdIntents).toEqual([]);
    expect(sentLinks).toEqual([]);
  });

  it("maps signup intent repo failures", async () => {
    const sqlError = new SqlError({ message: "db down" });
    const exit = await Effect.runPromise(
      requestSignupProgram({ email: "family@example.com", role: "family" }, new Headers(), "en").pipe(
        Effect.provide(
          makeLayer({
            create: () => Effect.fail(sqlError),
            sendSignupLink: () => Effect.void,
          }),
        ),
        Effect.exit,
      ),
    );

    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(SignupIntentError);
    expect(failure.cause).toBe(sqlError);
  });

  it("maps magic-link failures", async () => {
    const authError = new SignupAuthError({ cause: new Error("auth down") });
    const exit = await Effect.runPromise(
      requestSignupProgram({ email: "family@example.com", role: "family" }, new Headers(), "en").pipe(
        Effect.provide(
          makeLayer({
            create: (input) => Effect.succeed(makeSignupIntent(input)),
            sendSignupLink: () => Effect.fail(authError),
          }),
        ),
        Effect.exit,
      ),
    );

    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(SignupAuthError);
    expect(failure).toBe(authError);
  });
});
