/**
 * Session action routes (Tier 3, step 1):
 *
 *   POST /contracts/:id/sessions/:sessionId/actions   cancel, day off, report, dispute
 *   POST /contracts/:id/sessions/:sessionId/respond   accept / contest / decline
 *   GET  /contracts/:id/sessions/pending              what awaits the viewer's answer
 */
import type { SessionActionRefusal } from '@repo/billing';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authErrorToResponse, handleNever } from '@/api/lib/effect-auth';
import { requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  listPendingSessionResponsesRouteProgram,
  recordSessionActionRouteProgram,
  respondToSessionRouteProgram,
  type SessionActionRefusedError
} from './sessions';

type SessionRouteError =
  | Effect.Effect.Error<ReturnType<typeof recordSessionActionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof respondToSessionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listPendingSessionResponsesRouteProgram>>;

const refusalToResponse = (c: HonoContext<HonoEnv>, error: SessionActionRefusedError) => {
  const reason: SessionActionRefusal = error.reason;
  switch (reason) {
    case 'outside_window':
      return c.json(
        {
          error: {
            code: 'SESSION_OUTSIDE_WINDOW' as const,
            message: 'This session is beyond the dates you can act on yet.'
          }
        },
        409
      );
    case 'session_unavailable':
      return c.json(
        {
          error: {
            code: 'SESSION_UNAVAILABLE' as const,
            message: 'This session is suspended or cancelled.'
          }
        },
        409
      );
    case 'already_started':
      return c.json(
        {
          error: {
            code: 'SESSION_ALREADY_STARTED' as const,
            message: 'This session has already started.'
          }
        },
        409
      );
    case 'not_started':
      return c.json(
        {
          error: {
            code: 'SESSION_NOT_STARTED' as const,
            message: "This session hasn't started yet."
          }
        },
        409
      );
    case 'report_window_closed':
      return c.json(
        {
          error: {
            code: 'SESSION_REPORT_WINDOW_CLOSED' as const,
            message: 'It is too late to report on this session.'
          }
        },
        409
      );
    case 'day_off_too_late':
      return c.json(
        {
          error: {
            code: 'SESSION_DAY_OFF_TOO_LATE' as const,
            message: 'It is too late to propose a day off; cancel the session instead.'
          }
        },
        409
      );
    case 'already_resolved':
      return c.json(
        {
          error: {
            code: 'SESSION_ALREADY_RESOLVED' as const,
            message: 'Something is already recorded for this session.'
          }
        },
        409
      );
    case 'wrong_side':
      return c.json(
        {
          error: {
            code: 'SESSION_WRONG_SIDE' as const,
            message: 'This is for the other side of the contract.'
          }
        },
        403
      );
    case 'nothing_to_answer':
      return c.json(
        {
          error: {
            code: 'SESSION_NOTHING_TO_ANSWER' as const,
            message: 'Nothing on this session is waiting for your answer.'
          }
        },
        409
      );
    case 'response_window_closed':
      return c.json(
        {
          error: {
            code: 'SESSION_RESPONSE_WINDOW_CLOSED' as const,
            message: 'The time to answer has passed.'
          }
        },
        409
      );
    case 'not_disputable':
      return c.json(
        {
          error: {
            code: 'SESSION_NOT_DISPUTABLE' as const,
            message: 'This is already with Poppynz or decided.'
          }
        },
        409
      );
    case 'invalid_response':
      return c.json(
        {
          error: {
            code: 'SESSION_INVALID_RESPONSE' as const,
            message: 'A report is accepted or contested; a day off accepted or declined.'
          }
        },
        422
      );
    case 'invalid_minutes':
      return c.json(
        {
          error: {
            code: 'SESSION_INVALID_MINUTES' as const,
            message: 'Enter the minutes worked, fewer than the session lasts.'
          }
        },
        422
      );
    default:
      return handleNever(c, reason);
  }
};

const sessionRouteErrorToResponse = (c: HonoContext<HonoEnv>, error: SessionRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'SessionNotFoundError':
      return c.json(
        { error: { code: 'SESSION_NOT_FOUND' as const, message: 'Session not found.' } },
        404
      );
    case 'SessionRepoError':
      return c.json(
        {
          error: {
            code: 'SESSION_LOOKUP_FAILED' as const,
            message: 'Unable to process the session.'
          }
        },
        500
      );
    case 'SessionActionRefusedError':
      return refusalToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, SessionRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return sessionRouteErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function recordSessionActionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(recordSessionActionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function respondToSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(respondToSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function listPendingSessionResponsesHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(listPendingSessionResponsesRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
