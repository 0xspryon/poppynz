import { PayoutAccountRepo, type PayoutAccount } from '@repo/db';
import { Payments, type PaymentProvider } from '@repo/payments';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  currentPayoutAccount,
  loadPayoutAccount,
  mapPayoutsProviderError,
  mapPayoutsRepoError,
  payoutsPolicy,
  refreshPayoutAccount,
  requirementLabels
} from '@/api/lib/payouts';

/**
 * Helper payout account (piece 2b). Stripe hosts onboarding and the payout
 * dashboard; these routes create the account, hand out short-lived links and
 * report the status. They never block anything.
 */

export class NoPayoutAccountError extends Data.TaggedError('NoPayoutAccountError')<{}> {}

const toPayoutsResponse = (account: PayoutAccount | null, provider: PaymentProvider) => ({
  status: account?.status ?? null,
  paymentReady: account?.status === 'ready',
  requirementsDue: account ? requirementLabels(account.requirementsDue) : [],
  provider,
  hasAccount: account !== null
});

const requireAccount = (userId: string) =>
  Effect.gen(function* () {
    const account = yield* loadPayoutAccount(userId);
    if (!account) return yield* Effect.fail(new NoPayoutAccountError());
    return account;
  });

export const getPayoutsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* currentPayoutAccount(userAndSession.user.id);
    return toPayoutsResponse(account, payments.provider);
  });

export const startPayoutsOnboardingProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const repo = yield* PayoutAccountRepo;
    const { appWebOrigin } = yield* payoutsPolicy;
    const { id: userId, email } = userAndSession.user;

    let account = yield* loadPayoutAccount(userId);
    if (!account) {
      const created = yield* payments
        .createPayoutAccount({ userId, email })
        .pipe((errors) => mapPayoutsProviderError(errors));
      account = yield* repo
        .create({ userId, provider: payments.provider, accountReference: created.reference })
        .pipe((errors) => mapPayoutsRepoError(errors));
    }

    const link = yield* payments
      .createOnboardingLink({
        reference: account.accountReference,
        returnUrl: `${appWebOrigin}/service-provider/payouts?from=stripe`,
        refreshUrl: `${appWebOrigin}/service-provider/payouts?refresh=1`
      })
      .pipe((errors) => mapPayoutsProviderError(errors));
    return { url: link.url };
  });

export const refreshPayoutsProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* requireAccount(userAndSession.user.id);
    const refreshed = yield* refreshPayoutAccount(account);
    return toPayoutsResponse(refreshed, payments.provider);
  });

export const payoutsDashboardProgram = (userAndSession: UserAndSession) =>
  Effect.gen(function* () {
    const payments = yield* Payments;
    const account = yield* requireAccount(userAndSession.user.id);
    const link = yield* payments
      .createDashboardLink(account.accountReference)
      .pipe((errors) => mapPayoutsProviderError(errors));
    return { url: link.url };
  });

// ---------------------------------------------------------------------------
// Route programs (authenticate + authorize + domain)

const authorized = (headers: Headers, action: 'read' | 'write') =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    return yield* requirePermissions(headers, { payouts: [action] })(authenticated);
  });

export const getPayoutsRouteProgram = (headers: Headers) =>
  authorized(headers, 'read').pipe(Effect.flatMap(getPayoutsProgram));

export const startPayoutsOnboardingRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(startPayoutsOnboardingProgram));

export const refreshPayoutsRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(refreshPayoutsProgram));

export const payoutsDashboardRouteProgram = (headers: Headers) =>
  authorized(headers, 'write').pipe(Effect.flatMap(payoutsDashboardProgram));

export type PayoutsRouteError =
  | Effect.Effect.Error<ReturnType<typeof getPayoutsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof startPayoutsOnboardingRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof refreshPayoutsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof payoutsDashboardRouteProgram>>;

const unexpected = (c: HonoContext<HonoEnv>) =>
  c.json(
    { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
    500
  );

const payoutsErrorToResponse = (c: HonoContext<HonoEnv>, error: PayoutsRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'NoPayoutAccountError':
      return c.json(
        {
          error: {
            code: 'NO_PAYOUT_ACCOUNT' as const,
            message: 'Set up your payout account first.'
          }
        },
        409
      );
    case 'PayoutsProviderError':
      return c.json(
        {
          error: {
            code: 'PAYOUTS_PROVIDER_ERROR' as const,
            message: "Stripe couldn't be reached. Please try again in a moment."
          }
        },
        502
      );
    case 'PayoutsRepoError':
      return c.json(
        {
          error: {
            code: 'PAYOUTS_LOOKUP_FAILED' as const,
            message: 'Unable to load your payout account right now.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, PayoutsRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return payoutsErrorToResponse(c, failure.value);
      }
      return unexpected(c);
    }
  });

export async function getPayoutsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(getPayoutsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function startPayoutsOnboardingHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(startPayoutsOnboardingRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function refreshPayoutsHandler(c: HonoContext<HonoEnv>) {
  const exit = await c.get('runtime').runPromiseExit(refreshPayoutsRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function payoutsDashboardHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(payoutsDashboardRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}
