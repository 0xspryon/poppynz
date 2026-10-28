/**
 * Session refunds in the family's Billing (Tier 3 step 2, spec §9, §10):
 *
 *   GET /billing                        each contract charge lists its refunds
 *                                       (labelled with the session's date and
 *                                       service)
 *   GET /billing/refunds/:id/receipt    the refund receipt (credit note): what
 *                                       went back, the tax returned with its
 *                                       registration, the original charge
 *
 * Only the family who paid may read them (anyone else: not found).
 */
import type { SqlError } from '@effect/sql/SqlError';
import { personName } from '@repo/billing';
import {
  ContractBillingRepo,
  ContractRepo,
  PaymentRepo,
  SessionMoneyRepo,
  type SessionRefund
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authenticate,
  authErrorToResponse,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';
import { requestValidationErrorToResponse, validateInput } from '@/api/lib/schema-validator';

export class RefundRepoError extends Data.TaggedError('RefundRepoError')<{ cause: SqlError }> {}
export class RefundNotFoundError extends Data.TaggedError('RefundNotFoundError')<{}> {}

const mapRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(Effect.catchTag('SqlError', (cause) => Effect.fail(new RefundRepoError({ cause }))));

/** Session date and service of each refund (one sessions read per contract). */
const sessionsOf = (refunds: ReadonlyArray<SessionRefund>) =>
  Effect.gen(function* () {
    const repo = yield* ContractBillingRepo;
    const contracts = [...new Set(refunds.map((row) => row.contractId))];
    const lists = yield* Effect.forEach(contracts, (id) => repo.listSessions(id));
    return new Map(lists.flat().map((session) => [session.id, session]));
  });

export type HistoryRefund = {
  id: string;
  status: SessionRefund['status'];
  totalCents: number;
  createdAt: string;
  refundedAt: string | null;
  sessionDate: string | null;
  serviceName: string | null;
};

/** The refunds of these payments, by payment (for the Billing history). */
export const refundsByPayment = (paymentIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const refunds = yield* (yield* SessionMoneyRepo).listRefunds({ paymentIds });
    const sessions = yield* sessionsOf(refunds);
    const byPayment = new Map<string, Array<HistoryRefund>>();
    for (const refund of refunds) {
      const session = sessions.get(refund.sessionId);
      byPayment.set(refund.paymentId, [
        ...(byPayment.get(refund.paymentId) ?? []),
        {
          id: refund.id,
          // A handled failure (`cancelled`) was settled outside Stripe; the
          // web labels it "Settled by our team".
          status: refund.status,
          totalCents: refund.totalCents,
          createdAt: refund.createdAt.toISOString(),
          refundedAt: refund.refundedAt?.toISOString() ?? null,
          sessionDate: session?.date ?? null,
          serviceName: session?.serviceName ?? null
        }
      ]);
    }
    return byPayment;
  });

const receiptLines = (lines: SessionRefund['feeTaxLines']) =>
  lines
    .filter((line) => line.taxCents > 0)
    .map((line) => ({
      label: line.label,
      taxCents: line.taxCents,
      baseCents: line.baseCents,
      registrationNumber: line.registrationNumber
    }));

/** One refund receipt (credit note), for the family who paid. */
export const refundReceiptProgram = (viewerUserId: string, refundId: string) =>
  Effect.gen(function* () {
    const refund = yield* (yield* SessionMoneyRepo)
      .findRefund(refundId)
      .pipe((errors) => mapRepoError(errors));
    if (!refund) return yield* Effect.fail(new RefundNotFoundError());
    const payment = yield* (yield* PaymentRepo).findById(refund.paymentId).pipe(
      Effect.catchTag('DBNotFoundError', () => Effect.succeed(null)),
      (errors) => mapRepoError(errors)
    );
    if (!payment || payment.userId !== viewerUserId) {
      return yield* Effect.fail(new RefundNotFoundError());
    }
    const sessions = yield* sessionsOf([refund]).pipe((errors) => mapRepoError(errors));
    const session = sessions.get(refund.sessionId) ?? null;
    const contract = yield* (yield* ContractRepo)
      .findById(refund.contractId)
      .pipe((errors) => mapRepoError(errors));
    const helperName = contract ? (yield* personName(contract.providerUserId)).name : null;
    return {
      receipt: {
        id: refund.id,
        // "CN-" + the refund id's tail: a stable, readable credit-note number.
        number: `CN-${refund.id.replace(/-/g, '').slice(-10).toUpperCase()}`,
        status: refund.status,
        createdAt: refund.createdAt.toISOString(),
        refundedAt: refund.refundedAt?.toISOString() ?? null,
        careCents: refund.careCents,
        feeCents: refund.feeCents,
        taxCents: refund.careTaxCents + refund.feeTaxCents,
        totalCents: refund.totalCents,
        taxLines: [...receiptLines(refund.careTaxLines), ...receiptLines(refund.feeTaxLines)],
        session: session
          ? {
              date: session.date,
              serviceName: session.serviceName,
              startMinutes: session.startMinutes,
              endMinutes: session.endMinutes
            }
          : null,
        charge: {
          id: payment.id,
          description: payment.description,
          chargedAt: (payment.capturedAt ?? payment.createdAt).toISOString(),
          totalCents: payment.capturedCents ?? payment.totalCents
        },
        currency: payment.currency,
        helperName
      }
    };
  });

const refundIdSchema = Schema.UUID;
const validateRefundId = validateInput(refundIdSchema, {
  code: 'INVALID_REFUND_ID',
  message: 'Unknown refund.'
} as const);

export const refundReceiptRouteProgram = (c: HonoContext<HonoEnv>, headers: Headers) =>
  Effect.gen(function* () {
    const id = yield* validateRefundId(c.req.param('id'));
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { billing: ['read'] })(authenticated);
    return yield* refundReceiptProgram(userAndSession.user.id, id);
  });

type RefundRouteError = Effect.Effect.Error<ReturnType<typeof refundReceiptRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: RefundRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'RefundNotFoundError':
      return c.json(
        { error: { code: 'REFUND_NOT_FOUND' as const, message: 'Refund not found.' } },
        404
      );
    case 'RefundRepoError':
      return c.json(
        { error: { code: 'REFUND_LOOKUP_FAILED' as const, message: 'Unable to load the refund.' } },
        500
      );
    default:
      return handleNever(c, error);
  }
};

export async function refundReceiptHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(refundReceiptRouteProgram(c, c.req.raw.headers));
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
