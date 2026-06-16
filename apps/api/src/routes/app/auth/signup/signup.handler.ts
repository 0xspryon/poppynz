import type { SqlError } from "@effect/sql/SqlError";
import { SignupIntentRepo, UserRepo } from "@repo/db";
import { Cause, Context, Data, Effect, Exit, Layer, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../../app-env";
import { auth } from "../../../../lib/auth";
import { validLanguages, signupIntentTtlMs, validRoles } from "../../../../lib/constants";
import { SignupInput } from "./signup.validator";

export type SignupRole = (typeof validRoles)[number];
export type SignupLanguage = (typeof validLanguages)[number];

export class SignupIntentError extends Data.TaggedError("SignupIntentError")<{
  cause: SqlError;
}> {}

export class SignupUserLookupError extends Data.TaggedError("SignupUserLookupError")<{
  cause: SqlError;
}> {}

export class SignupUserAlreadyExistsError extends Data.TaggedError("SignupUserAlreadyExistsError")<{}> {}

export class SignupAuthError extends Data.TaggedError("SignupAuthError")<{
  cause: unknown;
}> {}

export type SignupError = SignupIntentError | SignupUserLookupError | SignupUserAlreadyExistsError | SignupAuthError;

export class SignupService extends Context.Tag("@api/routes/auth/signup/SignupService")<
  SignupService,
  {
    sendSignupLink: (input: {
      email: string;
      role: SignupRole;
      headers: Headers;
    }) => Effect.Effect<void, SignupAuthError>;
  }
>() {}

export const SignupServiceLive = Layer.succeed(SignupService, {
  sendSignupLink: ({ email, role, headers }) =>
    Effect.tryPromise({
      try: async () => {
        await auth.api.signInMagicLink({
          body: {
            email,
            callbackURL: "/onboarding",
            newUserCallbackURL:
              role === "service-provider" ? "/service-provider/onboarding" : "/family/onboarding",
            errorCallbackURL: "/auth/sign-up/error",
            metadata: { signupRole: role },
          },
          headers,
        });
      },
      catch: (cause) => new SignupAuthError({ cause }),
    }),
});

export const makeSignupServiceTest = (implementation: Context.Tag.Service<SignupService>) =>
  Layer.succeed(SignupService, implementation);

export const EmptySignupServiceTest = makeSignupServiceTest({
  sendSignupLink: (_: { email: string; role: SignupRole; headers: Headers }) => Effect.void,
})

export const requestSignupProgram = (body: SignupInput, headers: Headers, language: SignupLanguage) =>
  Effect.gen(function* () {
    const intentRepo = yield* SignupIntentRepo;
    const userRepo = yield* UserRepo;
    const signupService = yield* SignupService;
    const email = body.email

    const existingUser = yield* userRepo
      .findByEmail(email)
      .pipe(
        Effect.catchTag("DBNotFoundError", () => Effect.succeed(null)),
        Effect.mapError((cause) => new SignupUserLookupError({ cause })),
      );

    if (existingUser) {
      return yield* Effect.fail(new SignupUserAlreadyExistsError());
    }

    yield* intentRepo
      .create({
        email,
        role: body.role,
        language: language,
        expiresAt: new Date(Date.now() + signupIntentTtlMs),
      })
      .pipe(Effect.mapError((cause) => new SignupIntentError({ cause })));

    yield* signupService.sendSignupLink({ email, role: body.role, headers });

    return { ok: true };
  });

const signupErrorToResponse = (c: HonoContext<HonoEnv>, error: SignupError) => {
  switch (error._tag) {
    case "SignupIntentError":
      return c.json(
        {
          error: {
            code: "SIGNUP_INTENT_FAILED" as const,
            message: "Unable to start signup.",
          },
        },
        500,
      );

    case "SignupUserLookupError":
      return c.json(
        {
          error: {
            code: "SIGNUP_USER_LOOKUP_FAILED" as const,
            message: "Unable to start signup.",
          },
        },
        500,
      );

    case "SignupUserAlreadyExistsError":
      return c.json(
        {
          error: {
            code: "USER_ALREADY_EXISTS" as const,
            message: "An account already exists for this email.",
          },
        },
        409,
      );

    case "SignupAuthError":
      return c.json(
        {
          error: {
            code: "SIGNUP_LINK_FAILED" as const,
            message: "Unable to send signup link.",
          },
        },
        500,
      );
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR" as const,
        message: "Unexpected server error.",
      },
    },
    500,
  );

const isSignupError = (error: unknown): error is SignupError =>
  error instanceof SignupIntentError ||
  error instanceof SignupUserLookupError ||
  error instanceof SignupUserAlreadyExistsError ||
  error instanceof SignupAuthError;

export async function signupHandler(c: HonoContext<HonoEnv>, body: SignupInput) {
  const headers = c.req.raw.headers
  const runtime = c.get('runtime')
  const language = c.get('language')
  const exit = await runtime.runPromiseExit(requestSignupProgram(body, headers, language));

  return Exit.match(exit, {
    onSuccess: (result) => c.json(result),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure) && isSignupError(failure.value)) {
        return signupErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    },
  });
};
