import type { SqlError } from "@effect/sql/SqlError";
import { UserRepo } from "@repo/db";
import { Cause, Context, Data, Effect, Exit, Layer, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../../app-env";
import { auth } from "../../../../lib/auth";
import type { SigninInput } from "./signin.validator";

export class SigninUserLookupError extends Data.TaggedError("SigninUserLookupError")<{
  cause: SqlError;
}> {}

export class SigninUserNotFoundError extends Data.TaggedError("SigninUserNotFoundError")<{}> {}

export class SigninAuthError extends Data.TaggedError("SigninAuthError")<{
  cause: unknown;
}> {}

export type SigninError = SigninUserLookupError | SigninUserNotFoundError | SigninAuthError;

export class SigninService extends Context.Tag("@api/routes/auth/signin/SigninService")<
  SigninService,
  {
    sendSigninLink: (input: { email: string; headers: Headers }) => Effect.Effect<void, SigninAuthError>;
  }
>() {}

export const SigninServiceLive = Layer.succeed(SigninService, {
  sendSigninLink: ({ email, headers }) =>
    Effect.tryPromise({
      try: async () => {
        await auth.api.signInMagicLink({
          body: {
            email,
            callbackURL: "/",
            errorCallbackURL: "/auth/sign-in/error",
          },
          headers,
        });
      },
      catch: (cause) => new SigninAuthError({ cause }),
    }),
});

export const makeSigninServiceTest = (implementation: Context.Tag.Service<SigninService>) =>
  Layer.succeed(SigninService, implementation);

export const EmptySigninServiceTest = makeSigninServiceTest({
  sendSigninLink: (_: { email: string; headers: Headers }) => Effect.void,
});

export const requestSigninProgram = (body: SigninInput, headers: Headers) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;
    const signinService = yield* SigninService;
    const email = body.email;

    yield* userRepo.findByEmail(email).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new SigninUserNotFoundError()),
        SqlError: (cause) => Effect.fail(new SigninUserLookupError({ cause })),
      }),
    );

    yield* signinService.sendSigninLink({ email, headers });

    return { ok: true };
  });

const signinErrorToResponse = (c: HonoContext<HonoEnv>, error: SigninError) => {
  switch (error._tag) {
    case "SigninUserLookupError":
      return c.json(
        {
          error: {
            code: "SIGNIN_USER_LOOKUP_FAILED" as const,
            message: "Unable to start sign in.",
          },
        },
        500,
      );
    case "SigninUserNotFoundError":
      return c.json(
        {
          error: {
            code: "USER_NOT_FOUND" as const,
            message: "No account exists for this email.",
          },
        },
        404,
      );
    case "SigninAuthError":
      return c.json(
        {
          error: {
            code: "SIGNIN_LINK_FAILED" as const,
            message: "Unable to send sign-in link.",
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

const isSigninError = (error: unknown): error is SigninError =>
  error instanceof SigninUserLookupError || error instanceof SigninUserNotFoundError || error instanceof SigninAuthError;

const exitToResponse = <TResult>(c: HonoContext<HonoEnv>, exit: Exit.Exit<TResult, unknown>) =>
  Exit.match(exit, {
    onSuccess: (result) => c.json(result),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure) && isSigninError(failure.value)) {
        return signinErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    },
  });

export async function signinHandler(c: HonoContext<HonoEnv>, body: SigninInput) {
  const headers = c.req.raw.headers;
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(requestSigninProgram(body, headers));

  return exitToResponse(c, exit);
}
