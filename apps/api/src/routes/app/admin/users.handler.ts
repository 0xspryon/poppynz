import type { SqlError } from "@effect/sql/SqlError";
import { type DirectoryUser, UserDirectoryRepo } from "@repo/db";
import { Cause, Data, Effect, Exit, Option } from "effect";
import type { HonoContext, HonoEnv } from "../../../app-env";
import {
  authenticate,
  requirePermissions,
  authErrorToResponse,
  handleNever,
} from "@/api/lib/effect-auth";

export class UserDirectoryRepoError extends Data.TaggedError("UserDirectoryRepoError")<{
  cause: SqlError;
}> { }

const toDirectoryUserResponse = (user: DirectoryUser) => {
  const profileName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return {
    id: user.id,
    email: user.email,
    name: profileName || user.name || user.email,
    role: user.role,
    banned: user.banned,
    banReason: user.banReason,
    createdAt: user.createdAt.toISOString(),
  };
};

export const listAdminUsersRouteProgram = (headers: Headers) =>
  Effect.gen(function*() {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, {
      user: ["list"],
    })(authenticated);
    const userDirectoryRepo = yield* UserDirectoryRepo;
    const users = yield* userDirectoryRepo
      .listAll()
      .pipe(Effect.mapError((cause) => new UserDirectoryRepoError({ cause })));

    return { users: users.map(toDirectoryUserResponse) };
  });

export type AdminUsersRouteError = Effect.Effect.Error<ReturnType<typeof listAdminUsersRouteProgram>>;

const adminUsersRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: AdminUsersRouteError) => {
  switch (error._tag) {
    case "UnauthorizedError":
    case "ForbiddenError":
    case "AuthProviderError":
    case "AuthEntityLookupError":
      return authErrorToResponse(c, error);
    case "UserDirectoryRepoError":
      return c.json(
        { error: { code: "USER_LIST_FAILED" as const, message: "Unable to load users." } },
        500,
      );
    default:
      return handleNever(c, error);
  }
};

const unexpectedErrorResponse = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: "INTERNAL_SERVER_ERROR" as const, message: "Unexpected server error." } },
    500,
  );

const exitToResponse = <TData>(c: HonoContext<HonoEnv>, exit: Exit.Exit<TData, AdminUsersRouteError>) =>
  Exit.match(exit, {
    onSuccess: (data) => c.json(data),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return adminUsersRouteErrorToResponse(c, failure.value);
      }

      return unexpectedErrorResponse(c);
    },
  });

export async function listAdminUsersHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get("runtime");
  const exit = await runtime.runPromiseExit(listAdminUsersRouteProgram(c.req.raw.headers));

  return exitToResponse(c, exit);
}
