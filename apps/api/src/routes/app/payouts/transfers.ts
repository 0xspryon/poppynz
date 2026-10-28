/**
 * The helper's transfers (Tier 3 step 2, spec §8, §10):
 *
 *   GET /payouts/transfers   per-cycle transfers — sent, arriving, held or
 *                            failed — with what each paid per session
 *
 * The session user's own transfers only (permission `payouts: read`).
 */
import type { SqlError } from '@effect/sql/SqlError';
import { personName } from '@repo/billing';
import { ContractBillingRepo, ContractRepo, SessionMoneyRepo, type HelperTransfer } from '@repo/db';
import { Cause, Data, Effect, Exit, Option } from 'effect';
import type { HonoContext, HonoEnv } from '@/api/app-env';
import {
  authErrorToResponse,
  authenticate,
  handleNever,
  requirePermissions
} from '@/api/lib/effect-auth';

export class TransfersRepoError extends Data.TaggedError('TransfersRepoError')<{
  cause: SqlError;
}> {}

const mapRepoError = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
  effect.pipe(
    Effect.catchTag('SqlError', (cause) => Effect.fail(new TransfersRepoError({ cause })))
  );

/** What the helper reads: scheduled (not yet due), held (their account
 * can't receive it, or it waits for a manual payout), sending, arriving (in
 * their Stripe balance, on its way to the bank), sent (paid out to the
 * bank, or paid manually), failed, or nothing due. */
export type TransferDisplayStatus =
  | 'scheduled'
  | 'held'
  | 'sending'
  | 'arriving'
  | 'sent'
  | 'failed'
  | 'nothing_due';

export const transferDisplayStatus = (status: HelperTransfer['status']): TransferDisplayStatus => {
  switch (status) {
    case 'due':
      return 'scheduled';
    case 'paused':
    case 'manual_review':
      return 'held';
    case 'sending':
      return 'sending';
    case 'sent':
      return 'arriving';
    case 'paid':
    case 'manual_paid':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'settled':
      return 'nothing_due';
  }
};

export const listHelperTransfersProgram = (helperUserId: string) =>
  Effect.gen(function* () {
    const money = yield* SessionMoneyRepo;
    const billing = yield* ContractBillingRepo;
    const transfers = yield* money
      .listTransfers({ helperUserId })
      .pipe((errors) => mapRepoError(errors));
    const items = yield* money
      .listTransferItems({ transferIds: transfers.map((row) => row.id) })
      .pipe((errors) => mapRepoError(errors));
    const contracts = [...new Set(transfers.map((row) => row.contractId))];
    const cycles = new Map<string, { startsOn: string; endsOn: string; index: number }>();
    const sessions = new Map<string, { date: string; serviceName: string }>();
    const families = new Map<string, string>();
    for (const contractId of contracts) {
      for (const cycle of yield* billing
        .listCycles(contractId)
        .pipe((errors) => mapRepoError(errors))) {
        cycles.set(cycle.id, cycle);
      }
      for (const session of yield* billing
        .listSessions(contractId)
        .pipe((errors) => mapRepoError(errors))) {
        sessions.set(session.id, session);
      }
      const contract = yield* (yield* ContractRepo)
        .findById(contractId)
        .pipe((errors) => mapRepoError(errors));
      if (contract) families.set(contractId, (yield* personName(contract.familyUserId)).name);
    }
    return {
      transfers: transfers.map((row) => {
        const cycle = cycles.get(row.cycleId);
        return {
          id: row.id,
          contractId: row.contractId,
          cycleId: row.cycleId,
          familyName: families.get(row.contractId) ?? null,
          cycleStartsOn: cycle?.startsOn ?? null,
          cycleEndsOn: cycle?.endsOn ?? null,
          sequence: row.sequence,
          status: transferDisplayStatus(row.status),
          amountCents: row.amountCents,
          grossCents: row.grossCents,
          recoveredCents: row.recoveredCents,
          dueAt: row.dueAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
          paidAt: row.paidAt?.toISOString() ?? null,
          items: items
            .filter((item) => item.transferId === row.id)
            .map((item) => {
              const session = item.sessionId ? sessions.get(item.sessionId) : undefined;
              return {
                kind: item.kind,
                amountCents: item.amountCents,
                sessionDate: session?.date ?? null,
                serviceName: session?.serviceName ?? null
              };
            })
        };
      })
    };
  });

export const listHelperTransfersRouteProgram = (headers: Headers) =>
  Effect.gen(function* () {
    const authenticated = yield* authenticate(headers);
    const userAndSession = yield* requirePermissions(headers, { payouts: ['read'] })(authenticated);
    return yield* listHelperTransfersProgram(userAndSession.user.id);
  });

type TransfersRouteError = Effect.Effect.Error<ReturnType<typeof listHelperTransfersRouteProgram>>;

const errorToResponse = (c: HonoContext<HonoEnv>, error: TransfersRouteError) => {
  switch (error._tag) {
    case 'UnauthorizedError':
    case 'ForbiddenError':
    case 'AuthProviderError':
    case 'AuthEntityLookupError':
      return authErrorToResponse(c, error);
    case 'TransfersRepoError':
      return c.json(
        {
          error: {
            code: 'TRANSFERS_LOOKUP_FAILED' as const,
            message: 'Unable to load your payouts.'
          }
        },
        500
      );
    default:
      return handleNever(c, error);
  }
};

export async function listHelperTransfersHandler(c: HonoContext<HonoEnv>) {
  const exit = await c
    .get('runtime')
    .runPromiseExit(listHelperTransfersRouteProgram(c.req.raw.headers));
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
