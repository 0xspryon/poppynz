import { FamilySearchQueue } from '@repo/queue';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';

export const scheduleFamilySearchReindexRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    yield* requirePermissions(headers, { familySearch: ['reindex'] })(authenticated);
    const queue = yield* FamilySearchQueue;
    const job = yield* queue.enqueueReindex();
    return { jobId: job.id, status: 'scheduled' as const };
  });

type AdminFamilySearchRouteError = Effect.Effect.Error<
  ReturnType<typeof scheduleFamilySearchReindexRouteProgram>
>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: AdminFamilySearchRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'FamilySearchQueueError':
      return c.json(
        {
          error: {
            code: 'FAMILY_SEARCH_REINDEX_SCHEDULE_FAILED' as const,
            message: 'Unable to schedule family search reindex.'
          }
        },
        502
      );
    default:
      return handleNever(c, error);
  }
};

export async function scheduleFamilySearchReindexHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    scheduleFamilySearchReindexRouteProgram(c.req.raw.headers)
  );

  return Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return errorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });
}
