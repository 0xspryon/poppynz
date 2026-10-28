/**
 * Extra-session routes (Tier 3 step 3) — see `./extra-sessions` for the
 * programs. Every refusal is its own error code (the web shows each as a
 * toast in the viewer's language).
 */
import type { ExtraSessionRefusal, ExtraSessionRefusedError } from '@repo/billing';
import { Cause, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import { authErrorToResponse, handleNever } from '@/api/lib/effect-auth';
import { requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import {
  cancelExtraSessionRouteProgram,
  listExtraSessionsRouteProgram,
  proposeExtraSessionRouteProgram,
  quoteExtraSessionRouteProgram,
  respondToExtraSessionRouteProgram,
  withdrawExtraSessionRouteProgram
} from './extra-sessions';

type ExtraSessionRouteError =
  | Effect.Effect.Error<ReturnType<typeof listExtraSessionsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof quoteExtraSessionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof proposeExtraSessionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof respondToExtraSessionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof withdrawExtraSessionRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof cancelExtraSessionRouteProgram>>;

const refusalToResponse = (c: HonoContext<HonoEnv>, error: ExtraSessionRefusedError) => {
  const reason: ExtraSessionRefusal = error.reason;
  const refused = <C extends string>(code: C, message: string, status: 403 | 409 | 422) =>
    c.json({ error: { code, message } }, status);
  switch (reason) {
    case 'contract_not_active':
      return refused(
        'EXTRA_SESSION_CONTRACT_NOT_ACTIVE' as const,
        'Extra sessions can only be added while the contract is running.',
        409
      );
    case 'billing_unavailable':
      return refused(
        'EXTRA_SESSION_BILLING_UNAVAILABLE' as const,
        'Extra sessions can’t be added while the contract’s billing is on hold.',
        409
      );
    case 'unknown_service':
      return refused(
        'EXTRA_SESSION_UNKNOWN_SERVICE' as const,
        'Choose one of the contract’s services.',
        422
      );
    case 'invalid_times':
      return refused(
        'EXTRA_SESSION_INVALID_TIMES' as const,
        'Choose a start and end time on the same day, long enough for a session.',
        422
      );
    case 'too_far_back':
      return refused(
        'EXTRA_SESSION_TOO_FAR_BACK' as const,
        'This date is too far in the past to add a session.',
        422
      );
    case 'beyond_window':
      return refused(
        'EXTRA_SESSION_BEYOND_WINDOW' as const,
        'This date is beyond the dates you can add sessions for yet.',
        422
      );
    case 'outside_contract':
      return refused(
        'EXTRA_SESSION_OUTSIDE_CONTRACT' as const,
        'This date is outside the contract’s dates.',
        422
      );
    case 'no_cycle':
      return refused(
        'EXTRA_SESSION_NO_CYCLE' as const,
        'This date has no billing period yet; try again tomorrow.',
        409
      );
    case 'overlap':
      return refused(
        'EXTRA_SESSION_OVERLAP' as const,
        'This time overlaps another session or proposal.',
        409
      );
    case 'authorisation_required':
      return refused(
        'EXTRA_SESSION_AUTHORISATION_REQUIRED' as const,
        'Tick the box to authorise the charge for this session.',
        422
      );
    case 'amount_changed':
      return refused(
        'EXTRA_SESSION_AMOUNT_CHANGED' as const,
        'The price of this session changed; check the new amount.',
        409
      );
    case 'not_priced':
      return refused(
        'EXTRA_SESSION_NOT_PRICED' as const,
        'This session can’t be priced right now.',
        409
      );
    case 'wrong_side':
      return refused(
        'EXTRA_SESSION_WRONG_SIDE' as const,
        'This is for the other side of the contract.',
        403
      );
    case 'nothing_to_answer':
      return refused(
        'EXTRA_SESSION_NOTHING_TO_ANSWER' as const,
        'This proposal is no longer waiting for an answer.',
        409
      );
    case 'response_window_closed':
      return refused(
        'EXTRA_SESSION_RESPONSE_WINDOW_CLOSED' as const,
        'The time to answer has passed.',
        409
      );
    case 'not_withdrawable':
      return refused(
        'EXTRA_SESSION_NOT_WITHDRAWABLE' as const,
        'Only your own proposal, before it is answered, can be withdrawn.',
        409
      );
    case 'not_cancellable':
      return refused(
        'EXTRA_SESSION_NOT_CANCELLABLE' as const,
        'This extra session can no longer be cancelled for free.',
        409
      );
    default:
      return handleNever(c, reason);
  }
};

export const extraSessionRouteErrorToResponse = (
  c: HonoContext<HonoEnv>,
  error: ExtraSessionRouteError
) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'ExtraSessionContractNotFoundError':
      return c.json(
        { error: { code: 'CONTRACT_NOT_FOUND' as const, message: 'Contract not found.' } },
        404
      );
    case 'ExtraSessionNotFoundError':
      return c.json(
        {
          error: { code: 'EXTRA_SESSION_NOT_FOUND' as const, message: 'Extra session not found.' }
        },
        404
      );
    case 'ExtraSessionRepoError':
      return c.json(
        {
          error: {
            code: 'EXTRA_SESSION_FAILED' as const,
            message: 'Unable to process the extra session.'
          }
        },
        500
      );
    case 'ExtraSessionRefusedError':
      return refusalToResponse(c, error);
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, ExtraSessionRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) return extraSessionRouteErrorToResponse(c, failure.value);
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function listExtraSessionsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(listExtraSessionsRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function quoteExtraSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(quoteExtraSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function proposeExtraSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(proposeExtraSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function respondToExtraSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(respondToExtraSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function withdrawExtraSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(withdrawExtraSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function cancelExtraSessionHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(cancelExtraSessionRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
