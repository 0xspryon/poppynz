import { UserSearchRepo, type UserSearchWithUser } from '@repo/db';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 50;

// Admin-only listing — silently clamp instead of rejecting, since the only
// caller is our own paginator.
const boundedPage = (raw: string | undefined) => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
};
const boundedPerPage = (raw: string | undefined) => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_PER_PAGE;
  return Math.min(value, MAX_PER_PAGE);
};

const toResponse = (search: UserSearchWithUser) => ({
  id: search.id,
  userId: search.userId,
  userName: search.userName,
  userEmail: search.userEmail,
  details: search.details,
  createdAt: search.createdAt.toISOString()
});

export const listUserSearchesRouteProgram = (
  headers: Headers,
  query: { page?: string; perPage?: string }
) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { userSearch: ['read'] })(authenticated);
    const page = boundedPage(query.page);
    const perPage = boundedPerPage(query.perPage);
    const repo = yield* UserSearchRepo;
    const result = yield* repo.listPaginated(page, perPage);

    return {
      searches: result.searches.map(toResponse),
      pagination: { page, perPage, total: result.total }
    };
  });

export type AdminUserSearchesRouteError = Effect.Effect.Error<
  ReturnType<typeof listUserSearchesRouteProgram>
>;

const adminUserSearchesErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: AdminUserSearchesRouteError
) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'SqlError':
      return c.json(
        {
          error: {
            code: 'USER_SEARCH_LIST_FAILED' as const,
            message: 'Unable to load user searches.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const exitToResponse = <T>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<T, AdminUserSearchesRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return adminUserSearchesErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    }
  });

export async function listUserSearchesHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    listUserSearchesRouteProgram(c.req.raw.headers, {
      page: c.req.query('page'),
      perPage: c.req.query('perPage')
    })
  );

  return exitToResponse(c, exit);
}
