import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  helperTransfer,
  payment,
  payoutAccount,
  providerBalanceTransaction,
  reconciliationRun,
  sessionRefund,
  type ReconciliationRunStatus,
  type ReconciliationRunTrigger
} from '../schema';

/**
 * Reconciliation with the payment provider (Tier 3 step 5, spec 2026-10-28
 * §16): the runs, the provider's balance transactions they imported (one row
 * per provider reference — re-importing updates it, never duplicates it),
 * the records of ours they are matched against, and the exact "paid to the
 * bank" match of helper transfers (§13.4).
 */

export type ReconciliationRun = InferSelectModel<typeof reconciliationRun>;
export type ProviderBalanceTransactionRow = InferSelectModel<typeof providerBalanceTransaction>;
export type BalanceTransactionUpsert = Omit<
  InferInsertModel<typeof providerBalanceTransaction>,
  'id' | 'importedAt' | 'updatedAt' | 'firstRunId' | 'lastRunId'
>;

/** Our side of a match: what a provider reference points at. */
export type ReconcilablePayment = {
  id: string;
  kind: string;
  providerReference: string | null;
  refundReference: string | null;
  status: string;
  totalCents: number;
  capturedCents: number | null;
  capturedAt: Date | null;
  refundedAt: Date | null;
};
export type ReconcilableRefund = {
  id: string;
  providerReference: string | null;
  totalCents: number;
  status: string;
  refundedAt: Date | null;
};
export type ReconcilableTransfer = {
  id: string;
  helperUserId: string;
  providerReference: string | null;
  amountCents: number | null;
  status: string;
  sentAt: Date | null;
  paidAt: Date | null;
  payoutReference: string | null;
  payoutMatch: string | null;
};

export type ReconciliationLookups = {
  payments: ReadonlyArray<ReconcilablePayment>;
  refunds: ReadonlyArray<ReconcilableRefund>;
  transfers: ReadonlyArray<ReconcilableTransfer>;
};

export class ReconciliationRepo extends Context.Tag('@repo/db/ReconciliationRepo')<
  ReconciliationRepo,
  {
    /** Starts a run unless one is running (null then). A run still
     * `running` that started before `staleBefore` is marked failed first (a
     * crashed worker never blocks reconciliation for good). */
    startRun: (input: {
      provider: string;
      trigger: ReconciliationRunTrigger;
      requestedByUserId: string | null;
      periodFrom: Date;
      periodTo: Date;
      startedAt: Date;
      staleBefore: Date;
    }) => Effect.Effect<ReconciliationRun | null, SqlError>;
    finishRun: (
      id: string,
      set: {
        status: Exclude<ReconciliationRunStatus, 'running'>;
        importedCount: number;
        matchedCount: number;
        unmatchedCount: number;
        payoutsExactCount: number;
        pages: number;
        error: string | null;
        finishedAt: Date;
      }
    ) => Effect.Effect<ReconciliationRun | null, SqlError>;
    /** The latest run of the provider, of a trigger if given (any status). */
    lastRun: (
      provider: string,
      trigger?: ReconciliationRunTrigger
    ) => Effect.Effect<ReconciliationRun | null, SqlError>;
    listRuns: (
      provider: string,
      limit: number
    ) => Effect.Effect<Array<ReconciliationRun>, SqlError>;
    /** Inserts new references, updates known ones (status, fees, match). */
    upsertTransactions: (
      runId: string,
      rows: ReadonlyArray<BalanceTransactionUpsert>
    ) => Effect.Effect<number, SqlError>;
    /** Provider transactions created in `[from, to)`, newest first. */
    listTransactions: (input: {
      provider: string;
      from: Date;
      to: Date;
    }) => Effect.Effect<Array<ProviderBalanceTransactionRow>, SqlError>;
    findTransaction: (id: string) => Effect.Effect<ProviderBalanceTransactionRow | null, SqlError>;
    /** Our rows behind these provider references. */
    lookups: (refs: {
      paymentReferences: ReadonlyArray<string>;
      refundReferences: ReadonlyArray<string>;
      transferReferences: ReadonlyArray<string>;
    }) => Effect.Effect<ReconciliationLookups, SqlError>;
    /** Our rows of the provider in `[from, to)`: payments captured, refunds
     * made (session refunds, one-off refunds), transfers sent. */
    ourRecordsBetween: (input: {
      provider: string;
      from: Date;
      to: Date;
    }) => Effect.Effect<ReconciliationLookups, SqlError>;
    /** The transfers a helper's payout paid out (by their references): moved
     * to `paid` with the payout and `exact`, from `sent` or from an
     * approximate `paid`. Resolves how many changed. */
    markTransfersPaidExactly: (input: {
      transferReferences: ReadonlyArray<string>;
      payoutReference: string;
      paidAt: Date;
    }) => Effect.Effect<number, SqlError>;
    /** Helpers' payout accounts that received transfers sent in `[from, to)`. */
    listPayoutAccountsWithTransfers: (input: {
      from: Date;
      to: Date;
    }) => Effect.Effect<Array<{ helperUserId: string; accountReference: string }>, SqlError>;
  }
>() {}

const paymentColumns = {
  id: payment.id,
  kind: payment.kind,
  providerReference: payment.providerReference,
  refundReference: payment.refundReference,
  status: payment.status,
  totalCents: payment.totalCents,
  capturedCents: payment.capturedCents,
  capturedAt: payment.capturedAt,
  refundedAt: payment.refundedAt
};
const refundColumns = {
  id: sessionRefund.id,
  providerReference: sessionRefund.providerReference,
  totalCents: sessionRefund.totalCents,
  status: sessionRefund.status,
  refundedAt: sessionRefund.refundedAt
};
const transferColumns = {
  id: helperTransfer.id,
  helperUserId: helperTransfer.helperUserId,
  providerReference: helperTransfer.providerReference,
  amountCents: helperTransfer.amountCents,
  status: helperTransfer.status,
  sentAt: helperTransfer.sentAt,
  paidAt: helperTransfer.paidAt,
  payoutReference: helperTransfer.payoutReference,
  payoutMatch: helperTransfer.payoutMatch
};

/** Rows per insert: 28 columns each stays far below Postgres's 65,535
 * bind parameters (a run may read up to RECONCILIATION_MAX_PAGES pages). */
export const UPSERT_BATCH_SIZE = 500;

/** One row per (provider, reference) — the last one read wins, since a
 * single `ON CONFLICT DO UPDATE` may not touch a row twice — in batches. */
export const upsertBatches = <A extends { provider: string; reference: string }>(
  rows: ReadonlyArray<A>,
  size = UPSERT_BATCH_SIZE
): Array<Array<A>> => {
  const unique = [
    ...new Map(rows.map((row) => [`${row.provider}|${row.reference}`, row])).values()
  ];
  const batches: Array<Array<A>> = [];
  for (let start = 0; start < unique.length; start += size) {
    batches.push(unique.slice(start, start + size));
  }
  return batches;
};

export const ReconciliationRepoLive = Layer.effect(
  ReconciliationRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    return {
      startRun: (input) =>
        Effect.gen(function* () {
          yield* db
            .update(reconciliationRun)
            .set({
              status: 'failed',
              error: 'abandoned (still running)',
              finishedAt: input.startedAt
            })
            .where(
              and(
                eq(reconciliationRun.provider, input.provider),
                eq(reconciliationRun.status, 'running'),
                lt(reconciliationRun.startedAt, input.staleBefore)
              )
            );
          const rows = yield* db
            .insert(reconciliationRun)
            .values({
              provider: input.provider,
              trigger: input.trigger,
              requestedByUserId: input.requestedByUserId,
              periodFrom: input.periodFrom,
              periodTo: input.periodTo,
              startedAt: input.startedAt,
              status: 'running'
            })
            .onConflictDoNothing()
            .returning();
          return rows[0] ?? null;
        }),

      finishRun: (id, set) =>
        db
          .update(reconciliationRun)
          .set(set)
          .where(and(eq(reconciliationRun.id, id), eq(reconciliationRun.status, 'running')))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),

      lastRun: (provider, trigger) =>
        db
          .select()
          .from(reconciliationRun)
          .where(
            and(
              eq(reconciliationRun.provider, provider),
              trigger ? eq(reconciliationRun.trigger, trigger) : undefined
            )
          )
          .orderBy(desc(reconciliationRun.startedAt))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),

      listRuns: (provider, limit) =>
        db
          .select()
          .from(reconciliationRun)
          .where(eq(reconciliationRun.provider, provider))
          .orderBy(desc(reconciliationRun.startedAt))
          .limit(limit),

      upsertTransactions: (runId, rows) =>
        Effect.forEach(
          upsertBatches(rows),
          (batch) =>
            db
              .insert(providerBalanceTransaction)
              .values(batch.map((row) => ({ ...row, firstRunId: runId, lastRunId: runId })))
              .onConflictDoUpdate({
                target: [providerBalanceTransaction.provider, providerBalanceTransaction.reference],
                set: {
                  status: sql`excluded.status`,
                  availableOn: sql`excluded.available_on`,
                  amountCents: sql`excluded.amount_cents`,
                  feeCents: sql`excluded.fee_cents`,
                  netCents: sql`excluded.net_cents`,
                  description: sql`excluded.description`,
                  feeDetails: sql`excluded.fee_details`,
                  paymentReference: sql`excluded.payment_reference`,
                  transferReference: sql`excluded.transfer_reference`,
                  payoutReference: sql`coalesce(excluded.payout_reference, ${providerBalanceTransaction.payoutReference})`,
                  matchStatus: sql`excluded.match_status`,
                  matchKind: sql`excluded.match_kind`,
                  matchedId: sql`excluded.matched_id`,
                  matchNote: sql`excluded.match_note`,
                  lastRunId: sql`excluded.last_run_id`,
                  updatedAt: new Date()
                }
              })
              .returning({ id: providerBalanceTransaction.id })
              .pipe(Effect.map((result) => result.length)),
          { concurrency: 1 }
        ).pipe(Effect.map((counts) => counts.reduce((total, count) => total + count, 0))),

      listTransactions: ({ provider, from, to }) =>
        db
          .select()
          .from(providerBalanceTransaction)
          .where(
            and(
              eq(providerBalanceTransaction.provider, provider),
              gte(providerBalanceTransaction.providerCreatedAt, from),
              lt(providerBalanceTransaction.providerCreatedAt, to)
            )
          )
          .orderBy(desc(providerBalanceTransaction.providerCreatedAt)),

      findTransaction: (id) =>
        db
          .select()
          .from(providerBalanceTransaction)
          .where(eq(providerBalanceTransaction.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),

      lookups: ({ paymentReferences, refundReferences, transferReferences }) =>
        Effect.all(
          {
            payments:
              paymentReferences.length + refundReferences.length === 0
                ? Effect.succeed([])
                : db
                    .select(paymentColumns)
                    .from(payment)
                    .where(
                      or(
                        paymentReferences.length > 0
                          ? inArray(payment.providerReference, [...paymentReferences])
                          : undefined,
                        refundReferences.length > 0
                          ? inArray(payment.refundReference, [...refundReferences])
                          : undefined
                      )
                    ),
            refunds:
              refundReferences.length === 0
                ? Effect.succeed([])
                : db
                    .select(refundColumns)
                    .from(sessionRefund)
                    .where(inArray(sessionRefund.providerReference, [...refundReferences])),
            transfers:
              transferReferences.length === 0
                ? Effect.succeed([])
                : db
                    .select(transferColumns)
                    .from(helperTransfer)
                    .where(inArray(helperTransfer.providerReference, [...transferReferences]))
          },
          { concurrency: 'unbounded' }
        ),

      ourRecordsBetween: ({ provider, from, to }) =>
        Effect.all(
          {
            payments: db
              .select(paymentColumns)
              .from(payment)
              .where(
                and(
                  eq(payment.provider, provider),
                  isNotNull(payment.providerReference),
                  or(
                    and(gte(payment.capturedAt, from), lt(payment.capturedAt, to)),
                    and(
                      eq(payment.status, 'refunded'),
                      gte(payment.refundedAt, from),
                      lt(payment.refundedAt, to)
                    )
                  )
                )
              ),
            refunds: db
              .select(refundColumns)
              .from(sessionRefund)
              .innerJoin(payment, eq(payment.id, sessionRefund.paymentId))
              .where(
                and(
                  eq(payment.provider, provider),
                  eq(sessionRefund.status, 'succeeded'),
                  gte(sessionRefund.refundedAt, from),
                  lt(sessionRefund.refundedAt, to)
                )
              )
              .pipe(Effect.map((rows) => rows.map((row) => row))),
            transfers: db
              .select(transferColumns)
              .from(helperTransfer)
              .where(
                and(
                  isNotNull(helperTransfer.providerReference),
                  gte(helperTransfer.sentAt, from),
                  lt(helperTransfer.sentAt, to)
                )
              )
          },
          { concurrency: 'unbounded' }
        ),

      markTransfersPaidExactly: ({ transferReferences, payoutReference, paidAt }) =>
        transferReferences.length === 0
          ? Effect.succeed(0)
          : db
              .update(helperTransfer)
              .set({
                status: 'paid',
                paidAt,
                payoutReference,
                payoutMatch: 'exact',
                updatedAt: new Date()
              })
              .where(
                and(
                  inArray(helperTransfer.providerReference, [...transferReferences]),
                  or(
                    eq(helperTransfer.status, 'sent'),
                    and(
                      eq(helperTransfer.status, 'paid'),
                      or(
                        sql`${helperTransfer.payoutMatch} is distinct from 'exact'`,
                        sql`${helperTransfer.payoutReference} is distinct from ${payoutReference}`
                      )
                    )
                  )
                )
              )
              .returning({ id: helperTransfer.id })
              .pipe(Effect.map((rows) => rows.length)),

      listPayoutAccountsWithTransfers: ({ from, to }) =>
        db
          .selectDistinct({
            helperUserId: helperTransfer.helperUserId,
            accountReference: payoutAccount.accountReference
          })
          .from(helperTransfer)
          .innerJoin(payoutAccount, eq(payoutAccount.userId, helperTransfer.helperUserId))
          .where(
            and(
              isNotNull(helperTransfer.providerReference),
              gte(helperTransfer.sentAt, from),
              lt(helperTransfer.sentAt, to)
            )
          )
    };
  })
);

export const ReconciliationRepoDefault = ReconciliationRepoLive.pipe(Layer.provide(DrizzleLive));

/** In-memory stand-in with the same rules (one running run, upsert by
 * reference, exact payout marking). */
export const makeInMemoryReconciliationRepo = (
  seed: {
    payments?: Array<ReconcilablePayment & { provider?: string }>;
    refunds?: Array<ReconcilableRefund & { provider?: string }>;
    transfers?: Array<ReconcilableTransfer>;
    accounts?: Array<{ helperUserId: string; accountReference: string }>;
  } = {}
) => {
  const state = {
    runs: [] as Array<ReconciliationRun>,
    transactions: [] as Array<ProviderBalanceTransactionRow>,
    payments: seed.payments ?? [],
    refunds: seed.refunds ?? [],
    transfers: seed.transfers ?? [],
    accounts: seed.accounts ?? []
  };
  let sequence = 0;
  const nextId = () => {
    sequence += 1;
    return `00000000-0000-7000-9000-${String(sequence).padStart(12, '0')}`;
  };
  const inRange = (at: Date | null, from: Date, to: Date) => at !== null && at >= from && at < to;
  const layer = Layer.succeed(ReconciliationRepo, {
    startRun: (input) =>
      Effect.sync(() => {
        for (const run of state.runs) {
          if (
            run.provider === input.provider &&
            run.status === 'running' &&
            run.startedAt < input.staleBefore
          ) {
            Object.assign(run, {
              status: 'failed',
              error: 'abandoned (still running)',
              finishedAt: input.startedAt
            });
          }
        }
        if (state.runs.some((run) => run.provider === input.provider && run.status === 'running')) {
          return null;
        }
        const run: ReconciliationRun = {
          id: nextId(),
          provider: input.provider,
          trigger: input.trigger,
          requestedByUserId: input.requestedByUserId,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          status: 'running',
          importedCount: 0,
          matchedCount: 0,
          unmatchedCount: 0,
          payoutsExactCount: 0,
          pages: 0,
          error: null,
          startedAt: input.startedAt,
          finishedAt: null,
          createdAt: input.startedAt
        };
        state.runs.push(run);
        return run;
      }),
    finishRun: (id, set) =>
      Effect.sync(() => {
        const run = state.runs.find((row) => row.id === id && row.status === 'running');
        if (!run) return null;
        Object.assign(run, set);
        return run;
      }),
    lastRun: (provider, trigger) =>
      Effect.sync(
        () =>
          [...state.runs]
            .filter((run) => run.provider === provider && (!trigger || run.trigger === trigger))
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null
      ),
    listRuns: (provider, limit) =>
      Effect.sync(() =>
        [...state.runs]
          .filter((run) => run.provider === provider)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, limit)
      ),
    upsertTransactions: (runId, rows) =>
      Effect.sync(() => {
        for (const row of rows) {
          const known = state.transactions.find(
            (txn) => txn.provider === row.provider && txn.reference === row.reference
          );
          if (known) {
            Object.assign(known, {
              ...row,
              payoutReference: row.payoutReference ?? known.payoutReference,
              providerCreatedAt: known.providerCreatedAt,
              lastRunId: runId,
              updatedAt: new Date()
            });
          } else {
            state.transactions.push({
              account: null,
              description: null,
              sourceReference: null,
              sourceType: null,
              paymentReference: null,
              transferReference: null,
              payoutReference: null,
              feeDetails: [],
              matchStatus: 'unmatched',
              matchKind: null,
              matchedId: null,
              matchNote: null,
              ...row,
              id: nextId(),
              firstRunId: runId,
              lastRunId: runId,
              importedAt: new Date(),
              updatedAt: new Date()
            } as ProviderBalanceTransactionRow);
          }
        }
        return rows.length;
      }),
    listTransactions: ({ provider, from, to }) =>
      Effect.sync(() =>
        state.transactions
          .filter((txn) => txn.provider === provider && inRange(txn.providerCreatedAt, from, to))
          .sort((a, b) => b.providerCreatedAt.getTime() - a.providerCreatedAt.getTime())
      ),
    findTransaction: (id) =>
      Effect.sync(() => state.transactions.find((txn) => txn.id === id) ?? null),
    lookups: ({ paymentReferences, refundReferences, transferReferences }) =>
      Effect.sync(() => ({
        payments: state.payments.filter(
          (row) =>
            (row.providerReference !== null && paymentReferences.includes(row.providerReference)) ||
            (row.refundReference !== null && refundReferences.includes(row.refundReference))
        ),
        refunds: state.refunds.filter(
          (row) =>
            row.providerReference !== null && refundReferences.includes(row.providerReference)
        ),
        transfers: state.transfers.filter(
          (row) =>
            row.providerReference !== null && transferReferences.includes(row.providerReference)
        )
      })),
    ourRecordsBetween: ({ provider, from, to }) =>
      Effect.sync(() => ({
        payments: state.payments.filter(
          (row) =>
            (row.provider ?? provider) === provider &&
            row.providerReference !== null &&
            (inRange(row.capturedAt, from, to) ||
              (row.status === 'refunded' && inRange(row.refundedAt, from, to)))
        ),
        refunds: state.refunds.filter(
          (row) =>
            (row.provider ?? provider) === provider &&
            row.status === 'succeeded' &&
            inRange(row.refundedAt, from, to)
        ),
        transfers: state.transfers.filter(
          (row) => row.providerReference !== null && inRange(row.sentAt, from, to)
        )
      })),
    markTransfersPaidExactly: ({ transferReferences, payoutReference, paidAt }) =>
      Effect.sync(() => {
        let moved = 0;
        for (const row of state.transfers) {
          if (
            row.providerReference === null ||
            !transferReferences.includes(row.providerReference)
          ) {
            continue;
          }
          const exactAlready =
            row.status === 'paid' &&
            row.payoutMatch === 'exact' &&
            row.payoutReference === payoutReference;
          if ((row.status === 'sent' || row.status === 'paid') && !exactAlready) {
            Object.assign(row, { status: 'paid', paidAt, payoutReference, payoutMatch: 'exact' });
            moved += 1;
          }
        }
        return moved;
      }),
    listPayoutAccountsWithTransfers: ({ from, to }) =>
      Effect.sync(() => {
        const helpers = new Set(
          state.transfers
            .filter((row) => row.providerReference !== null && inRange(row.sentAt, from, to))
            .map((row) => row.helperUserId)
        );
        return state.accounts.filter((account) => helpers.has(account.helperUserId));
      })
  });
  return { layer, state };
};
