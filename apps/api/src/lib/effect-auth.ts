import type { SqlError } from "@effect/sql/SqlError";
import { Session, SessionRepo, User, UserRepo } from "@repo/db";
import { Context, Data, Effect, Layer } from "effect";
import { auth } from "./auth";

export type AuthSession = {
  user: {
    id: string;
  };
  session: {
    id: string;
  };
};

export type Principal = {
  user: User;
  session: Session;
};

export type Permissions = Record<string, Array<string>>;

export class AuthProviderError extends Data.TaggedError("AuthProviderError")<{
  cause: unknown;
}> {}

export class AuthEntityLookupError extends Data.TaggedError("AuthEntityLookupError")<{
  cause: SqlError;
}> {}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{}> {}

export class ForbiddenError extends Data.TaggedError("ForbiddenError")<{}> {}

export class AuthService extends Context.Tag("@api/lib/AuthService")<
  AuthService,
  {
    getSession: (headers: Headers) => Effect.Effect<AuthSession | null, AuthProviderError>;
    userHasPermission: (
      headers: Headers,
      permissions: Permissions,
    ) => Effect.Effect<boolean, AuthProviderError>;
  }
>() {}

export const AuthServiceLive = Layer.succeed(AuthService, {
  getSession: (headers) =>
    Effect.tryPromise({
      try: async () => auth.api.getSession({ headers }),
      catch: (cause) => new AuthProviderError({ cause }),
    }).pipe(
      Effect.map((session) =>
        session
          ? {
              user: { id: session.user.id },
              session: { id: session.session.id },
            }
          : null,
      ),
    ),
  userHasPermission: (headers, permissions) =>
    Effect.tryPromise({
      try: async () => {
        const result = await auth.api.userHasPermission({
          headers,
          body: { permissions },
        });

        return result.success;
      },
      catch: (cause) => new AuthProviderError({ cause }),
    }),
});

export const makeAuthServiceTest = (implementation: Context.Tag.Service<AuthService>) =>
  Layer.succeed(AuthService, implementation);

export const authenticate = (headers: Headers) =>
  Effect.gen(function* () {
    const authService = yield* AuthService;
    const userRepo = yield* UserRepo;
    const sessionRepo = yield* SessionRepo;
    const authSession = yield* authService.getSession(headers);

    if (!authSession) {
      return yield* Effect.fail(new UnauthorizedError());
    }

    const user = yield* userRepo
      .findById(authSession.user.id)
      .pipe(Effect.mapError((cause) => new AuthEntityLookupError({ cause })));
    const session = yield* sessionRepo
      .findById(authSession.session.id)
      .pipe(Effect.mapError((cause) => new AuthEntityLookupError({ cause })));

    if (!user || !session) {
      return yield* Effect.fail(new UnauthorizedError());
    }

    return { user, session };
  });

export const requirePermissions = (headers: Headers, permissions: Permissions) => (principal: Principal) =>
  Effect.gen(function* () {
    const authService = yield* AuthService;
    const allowed = yield* authService.userHasPermission(headers, permissions);

    if (!allowed) {
      return yield* Effect.fail(new ForbiddenError());
    }

    return principal;
  });

export type AuthError = AuthProviderError | AuthEntityLookupError | UnauthorizedError | ForbiddenError;

export const isAuthError = (error: unknown): error is AuthError =>
  error instanceof AuthProviderError ||
  error instanceof AuthEntityLookupError ||
  error instanceof UnauthorizedError ||
  error instanceof ForbiddenError;
