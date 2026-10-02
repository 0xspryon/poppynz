import type { SqlError } from '@effect/sql/SqlError';
import { applyCardSetup, ensureBillingCustomer, toCard } from '@repo/billing';
import { BillingCustomerRepo, PaymentRepo, type BillingCard } from '@repo/db';
import { Payments, type PaymentProviderError } from '@repo/payments';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authenticate,
  authErrorToResponse,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { parseJsonBody, requestValidationErrorToResponse } from '@/api/lib/schema-validator';
import { billingJsonError, validateBillingCardConfirmInput } from './billing.validator';

export class BillingRepoError extends Data.TaggedError('BillingRepoError')<{ cause: SqlError }> {}
export class BillingProviderError extends Data.TaggedError('BillingProviderError')<{}> {}
/** A setup id that is not the caller's (or not ours at all). */
export class BillingCardSetupNotFoundError extends Data.TaggedError(
  'BillingCardSetupNotFoundError'
)<{}> {}
/** The setup exists but the provider has not finished it. */
export class BillingCardSetupIncompleteError extends Data.TaggedError(
  'BillingCardSetupIncompleteError'
)<{}> {}

const mapBillingError = <A, R>(
  effect: Effect.Effect<A, SqlError | PaymentProviderError, R>
): Effect.Effect<A, BillingRepoError | BillingProviderError, R> =>
  effect.pipe(
    Effect.catchTags({
      SqlError: (cause) => Effect.fail(new BillingRepoError({ cause })),
      PaymentProviderError: () => Effect.fail(new BillingProviderError())
    })
  );

const mapRepoError = <A, R>(
  effect: Effect.Effect<A, SqlError, R>
): Effect.Effect<A, BillingRepoError, R> =>
  effect.pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(new BillingRepoError({ cause }))));

/** Display fields only — the card reference never leaves the server. */
const toCardResponse = (card: BillingCard | null) =>
  card === null
    ? null
    : { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear };

const paymentStatusLabel = {
  pending: 'pending',
  authorised: 'paid',
  captured: 'paid',
  refunded: 'refunded',
  failed: 'failed'
} as const;

/** The card on file and the payment history. */
export const getBillingRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['read'] })(authenticated);
    const userId = userAndSession.user.id;
    const repo = yield* BillingCustomerRepo;
    const paymentRepo = yield* PaymentRepo;
    const payments = yield* Payments;

    const [customer, history] = yield* Effect.all(
      [
        repo.findByUserId(userId).pipe((errors) => mapRepoError(errors)),
        paymentRepo.listByUser(userId).pipe((errors) => mapRepoError(errors))
      ],
      { concurrency: 'unbounded' }
    );

    return {
      card: toCardResponse(toCard(customer, payments.provider)),
      payments: history.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        description: row.description,
        totalCents: row.totalCents,
        currency: row.currency,
        status: paymentStatusLabel[row.status],
        receiptUrl: row.receiptUrl
      })),
      provider: payments.provider
    };
  });

/** Starts adding (or replacing) the card on file: a setup the browser
 * confirms in the payment modal. */
export const startCardSetupRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['write'] })(
      authenticated
    );
    const payments = yield* Payments;
    const customer = yield* ensureBillingCustomer({
      id: userAndSession.user.id,
      email: userAndSession.user.email,
      name: userAndSession.user.name
    }).pipe((errors) => mapBillingError(errors));
    const setup = yield* payments
      .startCardSetup(customer.customerReference)
      .pipe((errors) => mapBillingError(errors));
    return {
      setupId: setup.reference,
      clientSecret: setup.clientSecret,
      provider: payments.provider
    };
  });

/** The browser finished a setup: re-fetch it and make its card the one on
 * file (detaching the card it replaces). */
export const confirmCardSetupRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const rawBody = yield* parseJsonBody(c, billingJsonError);
    const input = yield* validateBillingCardConfirmInput(rawBody);
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['write'] })(
      authenticated
    );
    const result = yield* applyCardSetup(input.setupId, userAndSession.user.id).pipe((errors) =>
      mapBillingError(errors)
    );
    switch (result.outcome) {
      case 'not_found':
        return yield* Effect.fail(new BillingCardSetupNotFoundError());
      case 'incomplete':
        return yield* Effect.fail(new BillingCardSetupIncompleteError());
      case 'saved': {
        const { brand, last4, expMonth, expYear } = result.card;
        return { card: { brand, last4, expMonth, expYear } };
      }
    }
  });

export type BillingRouteError =
  | Effect.Effect.Error<ReturnType<typeof getBillingRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof startCardSetupRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof confirmCardSetupRouteProgram>>;

const billingErrorToResponse = (c: HonoContext<HonoEnv>, error: BillingRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'BillingCardSetupNotFoundError':
      return c.json(
        {
          error: {
            code: 'BILLING_CARD_SETUP_NOT_FOUND' as const,
            message: 'That card setup was not found.'
          }
        },
        404
      );
    case 'BillingCardSetupIncompleteError':
      return c.json(
        {
          error: {
            code: 'BILLING_CARD_SETUP_INCOMPLETE' as const,
            message: 'The card has not been confirmed yet. Please try again.'
          }
        },
        409
      );
    case 'BillingProviderError':
      return c.json(
        {
          error: {
            code: 'BILLING_PROVIDER_UNAVAILABLE' as const,
            message: 'Payments are temporarily unavailable. Please try again shortly.'
          }
        },
        503
      );
    case 'BillingRepoError':
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, BillingRouteError>) =>
  Exit.match(exit, {
    onSuccess: (value) => c.json(value),
    onFailure: (cause) => {
      const failure = Cause.failureOption(cause);
      if (Option.isSome(failure)) {
        return billingErrorToResponse(c, failure.value);
      }
      return c.json(
        { error: { code: 'INTERNAL_SERVER_ERROR' as const, message: 'Unexpected server error.' } },
        500
      );
    }
  });

export async function getBillingHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(getBillingRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function startCardSetupHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(startCardSetupRouteProgram(c.req.raw.headers));
  return exitToResponse(c, exit);
}

export async function confirmCardSetupHandler(c: HonoContext<HonoEnv>) {
  const runtime = c.get('runtime');
  const exit = await runtime.runPromiseExit(confirmCardSetupRouteProgram(c, c.req.raw.headers));
  return exitToResponse(c, exit);
}
