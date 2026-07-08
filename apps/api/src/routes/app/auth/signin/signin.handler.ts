import type { SqlError } from "@effect/sql/SqlError";
import { UserRepo } from "@repo/db";
import { Cause, Context, Data, Effect, Exit, Layer, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../../app-env";
import { auth } from "../../../../lib/auth";
import {
  signinJsonError,
  validateSigninInput,
  type SigninInput,
} from "./signin.validator";
import {
  isRequestValidationError,
  parseJsonBody,
  requestValidationErrorToResponse,
  type RequestValidationError,
} from "@/api/lib/schema-validator";

export class SigninUserLookupError extends Data.TaggedError("SigninUserLookupError")<{
  cause: SqlError;
}> {}

export class SigninUserNotFoundError extends Data.TaggedError("SigninUserNotFoundError")<{}> {}

export class SigninAuthError extends Data.TaggedError("SigninAuthError")<{
  cause: unknown;
}> {}

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

const ensureSigninUserExists = (email: string) =>
  Effect.gen(function* () {
    const userRepo = yield* UserRepo;

    yield* userRepo.findByEmail(email).pipe(
      Effect.catchTags({
        DBNotFoundError: () => Effect.fail(new SigninUserNotFoundError()),
        SqlError: (cause) => Effect.fail(new SigninUserLookupError({ cause })),
      }),
    );
  });

export const requestSigninProgram = (body: SigninInput, headers: Headers) =>
  Effect.gen(function* () {
    const signinService = yield* SigninService;
    const email = body.email;

    yield* ensureSigninUserExists(email);

    yield* signinService.sendSigninLink({ email, headers });

    return { ok: true };
  });

export type SigninError = Effect.Effect.Error<ReturnType<typeof requestSigninProgram>>;

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

// The concrete error union matters: with a generic error parameter here,
// TypeScript widens the validation error's literal code to `string` when Hono
// infers the route schema, and the RPC client loses the discriminant.
type SigninRouteError = SigninError | RequestValidationError<typeof signinJsonError.code>;

const exitToResponse = <TResult>(c: HonoContext<HonoEnv>, exit: Exit.Exit<TResult, SigninRouteError>) =>
  Exit.match(exit, {
    onSuccess: (result) => c.json(result),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        if (isRequestValidationError(failure.value)) {
          return requestValidationErrorToResponse(c, failure.value);
        }

        if (isSigninError(failure.value)) {
          return signinErrorToResponse(c, failure.value);
        }
      }

      return unexpectedErrorResponse(c);
    },
  });

export async function signinHandler(c: HonoContext<HonoEnv>) {
  const headers = c.req.raw.headers;
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const rawBody = yield* parseJsonBody(c, signinJsonError);
      const input = yield* validateSigninInput(rawBody);

      return yield* requestSigninProgram(input, headers);
    }),
  );

  return exitToResponse(c, exit);
}
