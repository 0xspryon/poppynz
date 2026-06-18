import { SqlError } from "@effect/sql/SqlError";
import { DBNotFoundError, makeUserRepoTest, type User } from "@repo/db";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  makeSigninServiceTest,
  requestSigninProgram,
  SigninAuthError,
  SigninUserLookupError,
  SigninUserNotFoundError,
} from "./signin.handler";
import { signinInputSchema } from "./signin.validator";

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

const decodeSigninInput = Schema.decodeUnknownSync(signinInputSchema);
const isSigninInput = Schema.is(signinInputSchema);

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

const makeLayer = (options: {
  findByEmail: Parameters<typeof makeUserRepoTest>[0]["findByEmail"];
  sendSigninLink: (input: { email: string; headers: Headers }) => Effect.Effect<void, SigninAuthError>;
}) =>
  Layer.mergeAll(
    makeUserRepoTest({
      findById: (id: string) => Effect.fail(new DBNotFoundError({ entity: "user", value: id })),
      findByEmail: options.findByEmail,
    }),
    makeSigninServiceTest({ sendSigninLink: options.sendSigninLink }),
  );

describe("requestSigninProgram", () => {
  it("protects against punycode emails", () => {
    const valid = decodeSigninInput({ email: " user@münchen.de " });

    expect(valid).toEqual({ email: "user@xn--mnchen-3ya.de" });
  });
  it("validates signin input with Effect Schema", () => {
    const valid = decodeSigninInput({ email: " User@Example.com " });

    expect(valid).toEqual({ email: "user@example.com" });
    expect(isSigninInput({ email: "not-an-email" })).toBe(false);
    expect(isSigninInput({})).toBe(false);
  });

  it("sends a signin link for an existing user", async () => {
    const headers = new Headers({ "x-test-header": "test-value" });
    const sendSigninLink = vi.fn((_: { email: string; headers: Headers }) => Effect.void);

    const result = await Effect.runPromise(
      requestSigninProgram(decodeSigninInput({ email: "User@Example.com" }), headers).pipe(
        Effect.provide(
          makeLayer({
            findByEmail: () => Effect.succeed(makeUser()),
            sendSigninLink,
          }),
        ),
      ),
    );

    expect(result).toEqual({ ok: true });
    expect(sendSigninLink).toHaveBeenCalledWith({ email: "user@example.com", headers });
  });

  it("does not send a signin link when the user does not exist", async () => {
    const sentLinks: Array<unknown> = [];
    const exit = await Effect.runPromise(
      requestSigninProgram({ email: "missing@example.com" }, new Headers()).pipe(
        Effect.provide(
          makeLayer({
            findByEmail: () => Effect.fail(new DBNotFoundError({ entity: "user", value: "missing@example.com" })),
            sendSigninLink: (input) => {
              sentLinks.push(input);
              return Effect.void;
            },
          }),
        ),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)).toBeInstanceOf(SigninUserNotFoundError);
    expect(sentLinks).toEqual([]);
  });

  it("maps user lookup failures", async () => {
    const sqlError = new SqlError({ message: "db down" });
    const sentLinks: Array<unknown> = [];
    const exit = await Effect.runPromise(
      requestSigninProgram({ email: "user@example.com" }, new Headers()).pipe(
        Effect.provide(
          makeLayer({
            findByEmail: () => Effect.fail(sqlError),
            sendSigninLink: (input) => {
              sentLinks.push(input);
              return Effect.void;
            },
          }),
        ),
        Effect.exit,
      ),
    );

    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(SigninUserLookupError);
    expect(failure.cause).toBe(sqlError);
    expect(sentLinks).toEqual([]);
  });

  it("maps magic-link failures", async () => {
    const authError = new SigninAuthError({ cause: new Error("auth down") });
    const exit = await Effect.runPromise(
      requestSigninProgram({ email: "user@example.com" }, new Headers()).pipe(
        Effect.provide(
          makeLayer({
            findByEmail: () => Effect.succeed(makeUser()),
            sendSigninLink: () => Effect.fail(authError),
          }),
        ),
        Effect.exit,
      ),
    );

    expect(getFailure(exit)).toBe(authError);
  });
});
