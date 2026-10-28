/**
 * The admins' money queues (Tier 3 step 2, spec §7, §8; umbrella §8):
 *
 *   GET  /admin/money/payouts                      transfers that could not
 *                                                  be sent (paused, failed,
 *                                                  in the manual queue) and
 *                                                  their manual payouts
 *   POST /admin/money/transfers/:id/manual-payout  record a payout made
 *                                                  outside Stripe
 *   POST /admin/money/manual-payouts/:id/decide    approve (a second admin)
 *                                                  or reject it
 *   POST /admin/money/transfers/:id/retry          send a refused transfer again
 *   GET  /admin/money/refunds                      failed session refunds
 *   POST /admin/money/refunds/:id/retry            retry one
 *   POST /admin/money/refunds/:id/handled          settled another way
 *   GET  /admin/money/extra-sessions               extra sessions whose own
 *                                                  charge is unpaid (step 3)
 *
 * Gated by permissions only: `payoutQueue` (admins) and `refundQueue`
 * (admins and the accountant). Every action is audited.
 */
import {
  decideManualPayout,
  markRefundHandled,
  personName,
  recordManualPayout,
  retryRefund,
  retryTransfer,
  type MoneyAdminError
} from '@repo/billing';
import {
  ContractBillingRepo,
  ContractRepo,
  ExtraSessionRepo,
  SessionMoneyRepo,
  unpaidExtraSessionStatuses,
  type HelperTransfer
} from '@repo/db';
import { Cause, Data, Effect, Exit, Option, Schema } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions,
  type UserAndSession
} from '@/api/lib/effect-auth';
import {
  parseJsonBody,
  requestValidationErrorToResponse,
  validateInput
} from '@/api/lib/schema-validator';

/** Anything below the money rules failed (database, provider). */
export class AdminMoneyRepoError extends Data.TaggedError('AdminMoneyRepoError')<{
  cause: unknown;
}> {}

/** Keeps the typed refusals; anything else is an infrastructure failure. */
const mapFailure = <A, E extends { _tag: string }, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, MoneyAdminError | AdminMoneyRepoError, R> =>
  effect.pipe(
    Effect.catchAll(
      (error): Effect.Effect<never, MoneyAdminError | AdminMoneyRepoError> =>
        error._tag === 'MoneyAdminError'
          ? Effect.fail(error as unknown as MoneyAdminError)
          : Effect.fail(new AdminMoneyRepoError({ cause: error }))
    )
  );

const idOf = validateInput(Schema.UUID, {
  code: 'INVALID_MONEY_ID',
  message: 'A valid id is required.'
} as const);

export const manualPayoutValidationError = {
  code: 'INVALID_MANUAL_PAYOUT',
  message: 'Give the method, the reference, the amount paid (in cents) and the reason.'
} as const;
export const manualPayoutSchema = Schema.Struct({
  method: Schema.Literal('interac_etransfer', 'bank_transfer', 'cheque', 'other'),
  reference: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(200)),
  amountCents: Schema.Int.pipe(Schema.positive()),
  reason: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000))
});
const validateManualPayout = validateInput(manualPayoutSchema, manualPayoutValidationError);

export const decisionValidationError = {
  code: 'INVALID_MANUAL_PAYOUT_DECISION',
  message: 'Approve or reject; a rejection needs a note.'
} as const;
export const decisionSchema = Schema.Struct({
  decision: Schema.Literal('approved', 'rejected'),
  note: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(2000))))
});
const validateDecision = validateInput(decisionSchema, decisionValidationError);

export const handledValidationError = {
  code: 'INVALID_REFUND_HANDLED',
  message: 'Say how the refund was settled.'
} as const;
export const handledSchema = Schema.Struct({
  note: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(2000))
});
const validateHandled = validateInput(handledSchema, handledValidationError);

const cycleDatesOf = (contractId: string, cycleId: string) =>
  ContractBillingRepo.pipe(
    Effect.flatMap((repo) => repo.listCycles(contractId)),
    Effect.map((cycles) => cycles.find((cycle) => cycle.id === cycleId) ?? null)
  );

const transferView = (transfer: HelperTransfer) =>
  Effect.gen(function* () {
    const cycle = yield* cycleDatesOf(transfer.contractId, transfer.cycleId);
    const manual = yield* (yield* SessionMoneyRepo).listManualPayouts({
      transferIds: [transfer.id]
    });
    return {
      id: transfer.id,
      contractId: transfer.contractId,
      helperUserId: transfer.helperUserId,
      helperName: (yield* personName(transfer.helperUserId)).name,
      cycleStartsOn: cycle?.startsOn ?? null,
      cycleEndsOn: cycle?.endsOn ?? null,
      sequence: transfer.sequence,
      status: transfer.status,
      amountCents: transfer.amountCents,
      dueAt: transfer.dueAt.toISOString(),
      failureReason: transfer.failureReason,
      manualPayouts: manual.map((row) => ({
        id: row.id,
        status: row.status,
        method: row.method,
        reference: row.reference,
        amountCents: row.amountCents,
        reason: row.reason,
        recordedByUserId: row.recordedByUserId,
        recordedAt: row.recordedAt.toISOString(),
        decidedByUserId: row.decidedByUserId,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote
      }))
    };
  });

export const listPayoutQueueProgram = () =>
  Effect.gen(function* () {
    const transfers = yield* (yield* SessionMoneyRepo).listTransfers({
      statuses: ['paused', 'failed', 'manual_review']
    });
    return { transfers: yield* Effect.forEach(transfers, transferView) };
  }).pipe((errors) => mapFailure(errors));

export const recordManualPayoutProgram = (
  admin: UserAndSession,
  transferId: string,
  input: Schema.Schema.Type<typeof manualPayoutSchema>,
  now: Date
) =>
  recordManualPayout({ transferId, ...input }, admin.user.id, now).pipe(
    Effect.map((row) => ({ manualPayout: { id: row.id, status: row.status } })),
    (errors) => mapFailure(errors)
  );

export const decideManualPayoutProgram = (
  admin: UserAndSession,
  id: string,
  input: Schema.Schema.Type<typeof decisionSchema>,
  now: Date
) =>
  decideManualPayout(id, input.decision, admin.user.id, input.note ?? null, now).pipe(
    Effect.map((row) => ({ manualPayout: { id: row.id, status: row.status } })),
    (errors) => mapFailure(errors)
  );

export const retryTransferProgram = (admin: UserAndSession, id: string, now: Date) =>
  retryTransfer(id, admin.user.id, now).pipe(
    Effect.map((row) => ({ transfer: { id: row.id, status: row.status } })),
    (errors) => mapFailure(errors)
  );

export const listFailedRefundsProgram = () =>
  Effect.gen(function* () {
    const refunds = yield* (yield* SessionMoneyRepo).listRefunds({ statuses: ['failed'] });
    return {
      refunds: yield* Effect.forEach(refunds, (refund) =>
        Effect.gen(function* () {
          const billing = yield* ContractBillingRepo;
          const session = (yield* billing.listSessions(refund.contractId, refund.cycleId)).find(
            (row) => row.id === refund.sessionId
          );
          return {
            id: refund.id,
            contractId: refund.contractId,
            totalCents: refund.totalCents,
            failureReason: refund.failureReason,
            createdAt: refund.createdAt.toISOString(),
            sessionDate: session?.date ?? null,
            serviceName: session?.serviceName ?? null
          };
        })
      )
    };
  }).pipe((errors) => mapFailure(errors));

/** Tier 3 step 3: extra sessions whose own charge is still unpaid (being
 * charged, or declined and retried) — with whether the unpaid incident was
 * raised (`CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS` after it was due). */
export const listUnpaidExtraSessionsProgram = () =>
  Effect.gen(function* () {
    const rows = yield* (yield* ExtraSessionRepo).listByStatus(unpaidExtraSessionStatuses);
    return {
      extraSessions: yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const contract = yield* (yield* ContractRepo).findById(row.contractId);
          return {
            id: row.id,
            contractId: row.contractId,
            cycleId: row.cycleId,
            familyName: contract ? (yield* personName(contract.familyUserId)).name : null,
            helperName: contract ? (yield* personName(contract.providerUserId)).name : null,
            date: row.date,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            serviceName: row.serviceName,
            status: row.status,
            totalCents: row.familyTotalCents ?? row.quotedTotalCents,
            attempts: row.chargeAttempts,
            lastError: row.lastError,
            dueAt: row.chargeAt?.toISOString() ?? null,
            nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
            alerted: row.noticesSent.includes('unpaid_alert')
          };
        })
      )
    };
  }).pipe((errors) => mapFailure(errors));

export const retryRefundProgram = (admin: UserAndSession, id: string, now: Date) =>
  retryRefund(id, admin.user.id, now).pipe(
    Effect.map((row) => ({ refund: { id: row.id, status: row.status } })),
    (errors) => mapFailure(errors)
  );

export const markRefundHandledProgram = (
  admin: UserAndSession,
  id: string,
  input: Schema.Schema.Type<typeof handledSchema>,
  now: Date
) =>
  markRefundHandled(id, admin.user.id, input.note, now).pipe(
    Effect.map((row) => ({ refund: { id: row.id, status: row.status } })),
    (errors) => mapFailure(errors)
  );

// ---------------------------------------------------------------------------
// Route programs

const gate = (headers: Headers, permissions: Parameters<typeof requirePermissions>[1]) =>
  Effect.flatMap(authenticate(headers), requirePermissions(headers, permissions));

export const listPayoutQueueRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* gate(headers, { payoutQueue: ['read'] });
    return yield* listPayoutQueueProgram();
  });

export const recordManualPayoutRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateManualPayout(yield* parseJsonBody(c, manualPayoutValidationError));
    const admin = yield* gate(headers, { payoutQueue: ['read', 'record'] });
    return yield* recordManualPayoutProgram(admin, id, input, now);
  });

export const decideManualPayoutRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateDecision(yield* parseJsonBody(c, decisionValidationError));
    const admin = yield* gate(headers, { payoutQueue: ['read', 'approve'] });
    return yield* decideManualPayoutProgram(admin, id, input, now);
  });

export const retryTransferRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const admin = yield* gate(headers, { payoutQueue: ['read', 'record'] });
    return yield* retryTransferProgram(admin, id, now);
  });

export const listUnpaidExtraSessionsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* gate(headers, { payoutQueue: ['read'] });
    return yield* listUnpaidExtraSessionsProgram();
  });

export const listFailedRefundsRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    yield* gate(headers, { refundQueue: ['read'] });
    return yield* listFailedRefundsProgram();
  });

export const retryRefundRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const admin = yield* gate(headers, { refundQueue: ['read', 'write'] });
    return yield* retryRefundProgram(admin, id, now);
  });

export const markRefundHandledRouteProgram = (
  c: HonoContext<HonoEnv>,
  headers: Headers,
  now: Date = new Date()
) =>
  Effect.gen(function* () {
    const id = yield* idOf(c.req.param('id'));
    const input = yield* validateHandled(yield* parseJsonBody(c, handledValidationError));
    const admin = yield* gate(headers, { refundQueue: ['read', 'write'] });
    return yield* markRefundHandledProgram(admin, id, input, now);
  });

type AdminMoneyRouteError =
  | Effect.Effect.Error<ReturnType<typeof listPayoutQueueRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof recordManualPayoutRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof decideManualPayoutRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof retryTransferRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listFailedRefundsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof listUnpaidExtraSessionsRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof retryRefundRouteProgram>>
  | Effect.Effect.Error<ReturnType<typeof markRefundHandledRouteProgram>>;

const refusalToResponse = (c: HonoContext<HonoEnv>, error: MoneyAdminError) => {
  const reason = error.reason;
  switch (reason) {
    case 'not_found':
      return c.json(
        { error: { code: 'MONEY_ITEM_NOT_FOUND' as const, message: 'Not found.' } },
        404
      );
    case 'not_payable':
      return c.json(
        {
          error: {
            code: 'TRANSFER_NOT_PAYABLE' as const,
            message: 'Only a transfer in the manual queue (or refused) can be paid manually.'
          }
        },
        409
      );
    case 'amount_mismatch':
      return c.json(
        {
          error: {
            code: 'MANUAL_PAYOUT_AMOUNT_MISMATCH' as const,
            message: 'The amount must be exactly the transfer’s amount.'
          }
        },
        422
      );
    case 'already_recorded':
      return c.json(
        {
          error: {
            code: 'MANUAL_PAYOUT_ALREADY_RECORDED' as const,
            message: 'A manual payout is already recorded for this transfer.'
          }
        },
        409
      );
    case 'already_decided':
      return c.json(
        {
          error: {
            code: 'MANUAL_PAYOUT_ALREADY_DECIDED' as const,
            message: 'This manual payout was already decided.'
          }
        },
        409
      );
    case 'same_admin':
      return c.json(
        {
          error: {
            code: 'MANUAL_PAYOUT_SECOND_ADMIN' as const,
            message: 'Another admin must approve the payout you recorded.'
          }
        },
        403
      );
    case 'not_failed':
      return c.json(
        {
          error: {
            code: 'MONEY_ITEM_NOT_FAILED' as const,
            message: 'Only a failed item can be retried or handled.'
          }
        },
        409
      );
    default:
      return handleNever(c, reason);
  }
};

const errorToResponse = (c: HonoContext<HonoEnv>, error: AdminMoneyRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'RequestValidationError':
      return requestValidationErrorToResponse(c, error);
    case 'MoneyAdminError':
      return refusalToResponse(c, error);
    case 'AdminMoneyRepoError':
      return c.json(
        {
          error: { code: 'MONEY_QUEUE_FAILED' as const, message: 'Unable to process the request.' }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

const exitToResponse = <T>(c: HonoContext<HonoEnv>, exit: Exit.Exit<T, AdminMoneyRouteError>) =>
  Exit.match(exit, {
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

export async function listUnpaidExtraSessionsHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(listUnpaidExtraSessionsRouteProgram(c.req.raw.headers))
  );
}

export async function listPayoutQueueHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(listPayoutQueueRouteProgram(c.req.raw.headers))
  );
}
export async function recordManualPayoutHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(recordManualPayoutRouteProgram(c, c.req.raw.headers))
  );
}
export async function decideManualPayoutHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(decideManualPayoutRouteProgram(c, c.req.raw.headers))
  );
}
export async function retryTransferHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(retryTransferRouteProgram(c, c.req.raw.headers))
  );
}
export async function listFailedRefundsHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(listFailedRefundsRouteProgram(c.req.raw.headers))
  );
}
export async function retryRefundHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(retryRefundRouteProgram(c, c.req.raw.headers))
  );
}
export async function markRefundHandledHandler(c: HonoContext<HonoEnv>) {
  return exitToResponse(
    c,
    await c.get('runtime').runPromiseExit(markRefundHandledRouteProgram(c, c.req.raw.headers))
  );
}
