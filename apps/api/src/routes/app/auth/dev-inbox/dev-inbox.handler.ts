import { environmentConfig } from '@repo/env';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { handleNever } from '@/api/lib/effect-auth';
import { latestDevMagicLink } from '@/api/lib/dev-magic-links';
import { validateInput, requestValidationErrorToResponse } from '@/api/lib/schema-validator';

/** Outside dev the mock inbox does not exist at all. */
export class DevInboxUnavailableError extends Data.TaggedError('DevInboxUnavailableError')<{}> {}
export class DevInboxEmptyError extends Data.TaggedError('DevInboxEmptyError')<{}> {}
class DevInboxConfigError extends Data.TaggedError('DevInboxConfigError')<{}> {}

const validateQuery = validateInput(
  Schema.Struct({ email: Schema.Trim.pipe(Schema.nonEmptyString()) }),
  {
    code: 'INVALID_DEV_INBOX_QUERY',
    message: 'An email is required.'
  } as const
);

/** The latest real magic link for an address — dev only (UAT #32, B10). */
export const latestDevMagicLinkRouteProgram = (query: Record<string, string | undefined>) =>
  Effect.gen(function* () {
    const environment = yield* environmentConfig.pipe(
      Effect.mapError(() => new DevInboxConfigError())
    );
    if (environment !== 'dev') {
      return yield* Effect.fail(new DevInboxUnavailableError());
    }
    const input = yield* validateQuery(query);
    const entry = latestDevMagicLink(input.email);
    if (!entry) {
      return yield* Effect.fail(new DevInboxEmptyError());
    }
    return { link: entry.link, sentAt: entry.sentAt.toISOString() };
  });

type DevInboxError = Effect.Effect.Error<ReturnType<typeof latestDevMagicLinkRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: DevInboxError) => {
  switch (error._tag) {
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'DevInboxUnavailableError':
    case 'DevInboxConfigError':
      return c.json({ error: { code: 'NOT_FOUND' as const, message: 'Not found.' } }, 404);
    case 'DevInboxEmptyError':
      return c.json(
        {
          error: {
            code: 'DEV_INBOX_EMPTY' as const,
            message: 'No magic link has been sent to that address since the API started.'
          }
        },
        404
      );
    default:
      return handleNever(c, error);
  }
};

export async function latestDevMagicLinkHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(
    latestDevMagicLinkRouteProgram({ email: c.req.query('email') })
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
