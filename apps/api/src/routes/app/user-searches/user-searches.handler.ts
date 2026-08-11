import {
  UserProfileRepo,
  UserSearchRepo,
  type SafeUserProfile,
  type UserSearchLocation
} from '@repo/db';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { userSearchJsonError, validateUserSearchCreateInput } from './user-searches.validator';

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

// The location snapshot is derived server-side from the caller's profile at
// save time — clients can't supply it (the validator drops unknown fields).
const locationSnapshot = (profile: SafeUserProfile | null): UserSearchLocation | undefined => {
  if (!profile) return undefined;
  const location = {
    ...(profile.city ? { city: profile.city } : {}),
    ...(profile.stateProvince ? { stateProvince: profile.stateProvince } : {}),
    ...(profile.country ? { country: profile.country } : {}),
    ...(profile.latitude != null ? { latitude: profile.latitude } : {}),
    ...(profile.longitude != null ? { longitude: profile.longitude } : {})
  };
  return Object.keys(location).length > 0 ? location : undefined;
};

export const createUserSearchRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, userSearchJsonError);
    const input = yield* validateUserSearchCreateInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { userSearch: ['write'] })(
      authenticated
    );
    // A family without a saved profile still gets their search recorded.
    const profile = yield* UserProfileRepo.pipe(
      Effect.flatMap((repo) => repo.findByUserId(userAndSession.user.id)),
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null))
    );
    const location = locationSnapshot(profile);
    const repo = yield* UserSearchRepo;
    const saved = yield* repo.create({
      userId: userAndSession.user.id,
      details: location ? { ...input, location } : input
    });

    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  });

export type UserSearchRouteError = Effect.Effect.Error<
  ReturnType<typeof createUserSearchRouteProgram>
>;

const userSearchErrorToResponse = (c: HonoContext<HonoEnv>, error: UserSearchRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'SqlError':
      return c.json(
        {
          error: {
            code: 'USER_SEARCH_SAVE_FAILED' as const,
            message: 'Unable to save your search right now.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, UserSearchRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);

      if (Option.isSome(failure)) {
        return userSearchErrorToResponse(c, failure.value);
      }

      return unexpected(c);
    }
  });

export async function createUserSearchHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const headers = c.req.raw.headers;
  const exit = await runtime.runPromiseExit(createUserSearchRouteProgram(c, headers));

  return exitToResponse(c, exit);
}
