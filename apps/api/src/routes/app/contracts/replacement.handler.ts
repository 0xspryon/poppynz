/**
 * Replacement routes (Tier 3, step 1b):
 *
 *   GET  /contracts/:id/replacement?sessions=a,b   what is being replaced
 *   POST /contracts/:id/replacement                 a draft with another helper
 */
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { contractRouteErrorToResponse } from './contracts.handler';
import {
  createReplacementRouteProgram,
  replacementContextRouteProgram,
  type ReplacementSessionsInvalidError
} from './replacement';

export type ReplacementRouteError =
  | Effect.Effect.Error<ReturnType<typeof replacementContextRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof createReplacementRouteProgram>>;

const invalidSessionsMessage: Record<ReplacementSessionsInvalidError['reason'], string> = {
  unknown_session: 'One of these sessions is not on this contract.',
  not_cancelled_by_helper: 'Only sessions the helper cancelled can be replaced.',
  already_started: 'One of these sessions has already started.',
  mixed_services: 'Replace sessions of one service at a time.',
  not_one_stretch:
    "One short contract can't cover exactly these sessions: replace them in separate stretches."
};

const replacementErrorToResponse = (c: HonoContext<HonoEnv>, error: ReplacementRouteError) => {
  switch (error._tag) {
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ReplacementSessionsInvalidError':
      return c.json(
        {
          error: {
            code: 'REPLACEMENT_SESSIONS_INVALID' as const,
            message: invalidSessionsMessage[error.reason],
            reason: error.reason
          }
        },
        422
      );
    case 'ReplacementSameHelperError':
      return c.json(
        {
          error: {
            code: 'REPLACEMENT_SAME_HELPER' as const,
            message: 'Choose a different helper than the one who cancelled.'
          }
        },
        422
      );
    case 'ReplacementReachOutRequiredError':
      return c.json(
        {
          error: {
            code: 'REPLACEMENT_REACH_OUT_REQUIRED' as const,
            message:
              error.status === 'pending'
                ? 'Your message is waiting for this helper to accept it.'
                : error.status === 'ignored'
                  ? "This helper can't take on your request."
                  : 'Reach out to this helper first.',
            status: error.status,
            conversationId: error.conversationId
          }
        },
        409
      );
    case 'ReplacementServiceNotOfferedError':
      return c.json(
        {
          error: {
            code: 'REPLACEMENT_SERVICE_NOT_OFFERED' as const,
            message: "This helper doesn't offer the cancelled service."
          }
        },
        422
      );
    case 'ReplacementServiceNotPublishableError':
      return c.json(
        {
          error: {
            code: 'REPLACEMENT_SERVICE_NOT_AVAILABLE' as const,
            message: "This helper's listing for the service isn't approved for families yet."
          }
        },
        422
      );
    default:
      // Everything else is a contract-route error with its usual response.
      return contractRouteErrorToResponse(c, error);
  }
};

const exitToResponse = <TData>(
  c: HonoContext<HonoEnv>,
  exit: Exit.Exit<TData, ReplacementRouteError>
) =>
  Exit.match(exit, {
    onSuccess: (data) => c.json(data),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return replacementErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function replacementContextHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(replacementContextRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function createReplacementHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(createReplacementRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
