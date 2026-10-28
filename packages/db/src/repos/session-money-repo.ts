import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Data, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  billingAuditEvent,
  billingLedgerEntry,
  contract,
  contractCycle,
  contractSessionCharge,
  helperRecovery,
  helperTransfer,
  helperTransferItem,
  manualPayout,
  sessionMoneyEffect,
  sessionRefund
} from '../schema';
import type {
  BillingLedgerEntry,
  BillingLedgerInsert,
  ContractCycle,
  SessionCharge
} from './contract-billing-repo';

/**
 * Session money (Tier 3 step 2, spec 2026-10-28 §4.3, §4.4, §7, §8): the
 * session refunds, the recoveries from a helper's future earnings, the
 * session-based transfers and what each paid, the manual payout queue, how
 * each session's resolution was applied, and the money audit.
 *
 * Every write that must not happen twice is guarded in the database: a
 * refund by its key (`<resolution>:<outcome>`), a recovery by its key, a
 * transfer by (cycle, sequence), a live manual payout by its transfer; state
 * changes are compare-and-set on the status. Applying a resolution (the
 * effect, its refund or recovery and their ledger entries) is ONE
 * transaction, and the database refuses refunds above a session's frozen
 * charge or a payment's captured amount (`RefundLimitError`).
 */

export type SessionRefund = InferSelectModel<typeof sessionRefund>;
export type SessionRefundInsert = Omit<
  InferInsertModel<typeof sessionRefund>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type SessionRefundStatus = SessionRefund['status'];
export type HelperRecovery = InferSelectModel<typeof helperRecovery>;
export type HelperRecoveryInsert = Omit<
  InferInsertModel<typeof helperRecovery>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type HelperTransfer = InferSelectModel<typeof helperTransfer>;
export type HelperTransferInsert = Omit<
  InferInsertModel<typeof helperTransfer>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type HelperTransferStatus = HelperTransfer['status'];
export type HelperTransferItem = InferSelectModel<typeof helperTransferItem>;
export type HelperTransferItemInsert = Omit<
  InferInsertModel<typeof helperTransferItem>,
  'id' | 'createdAt' | 'transferId'
>;
export type ManualPayout = InferSelectModel<typeof manualPayout>;
export type ManualPayoutInsert = Omit<
  InferInsertModel<typeof manualPayout>,
  'id' | 'createdAt' | 'updatedAt' | 'status' | 'decidedByUserId' | 'decidedAt' | 'decisionNote'
>;
export type SessionMoneyEffect = InferSelectModel<typeof sessionMoneyEffect>;
export type SessionMoneyEffectInsert = Omit<
  InferInsertModel<typeof sessionMoneyEffect>,
  'updatedAt'
>;
export type BillingAuditEvent = InferSelectModel<typeof billingAuditEvent>;
export type BillingAuditInsert = Omit<
  InferInsertModel<typeof billingAuditEvent>,
  'id' | 'createdAt'
>;

/** A refund the database refused: above the session's frozen charge, or
 * above what the payment captured (spec §4.3 limits). */
export class RefundLimitError extends Data.TaggedError('RefundLimitError')<{
  refundKey: string;
  detail: string;
}> {}

type Patch<T> = Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>;

/** Statuses of a transfer that has fixed what it pays (items written). */
export const fixedTransferStatuses: ReadonlyArray<HelperTransferStatus> = [
  'sending',
  'sent',
  'paid',
  'failed',
  'settled',
  'manual_review',
  'manual_paid'
];

/** Statuses still waiting to go out. */
export const openTransferStatuses: ReadonlyArray<HelperTransferStatus> = [
  'due',
  'paused',
  'sending'
];

export type ApplyEffectInput = {
  effect: SessionMoneyEffectInsert;
  refund: SessionRefundInsert | null;
  recovery: HelperRecoveryInsert | null;
  ledger: ReadonlyArray<BillingLedgerInsert>;
};

export type ApplyEffectResult = {
  /** The refund on file for the key (this call's, or an earlier one's). */
  refund: SessionRefund | null;
  /** True when this call inserted the refund. */
  refundCreated: boolean;
  recovery: HelperRecovery | null;
};

export type FixTransferInput = {
  from: ReadonlyArray<HelperTransferStatus>;
  set: Patch<HelperTransfer>;
  items: ReadonlyArray<HelperTransferItemInsert>;
  /** Recoveries deducted by this transfer: their new totals (compare-and-set
   * on the recovered amount read). */
  recoveries: ReadonlyArray<{ id: string; fromRecoveredCents: number; recoveredCents: number }>;
  ledger: ReadonlyArray<BillingLedgerInsert>;
};

/** A captured cycle and its helper, for the transfer step. */
export type TransferableCycle = { cycle: ContractCycle; helperUserId: string };

export class SessionMoneyRepo extends Context.Tag('@repo/db/SessionMoneyRepo')<
  SessionMoneyRepo,
  {
    /** Applies one session's resolution to the money in ONE transaction:
     * the effect (upserted), the refund and recovery (each once per key)
     * and their ledger entries. Fails with `RefundLimitError` (and writes
     * nothing) when the refund would break a limit. */
    applyEffect: (
      input: ApplyEffectInput
    ) => Effect.Effect<ApplyEffectResult, SqlError | RefundLimitError>;
    listEffects: (contractId: string) => Effect.Effect<Array<SessionMoneyEffect>, SqlError>;

    listRefunds: (filter: {
      contractId?: string;
      sessionId?: string;
      paymentIds?: ReadonlyArray<string>;
      statuses?: ReadonlyArray<SessionRefundStatus>;
    }) => Effect.Effect<Array<SessionRefund>, SqlError>;
    findRefund: (id: string) => Effect.Effect<SessionRefund | null, SqlError>;
    findRefundByProviderReference: (
      reference: string
    ) => Effect.Effect<SessionRefund | null, SqlError>;
    advanceRefund: (
      id: string,
      input: { from: ReadonlyArray<SessionRefundStatus>; set: Patch<SessionRefund> }
    ) => Effect.Effect<SessionRefund | null, SqlError>;
    /** Appends a notice once; null when it was already recorded. */
    appendRefundNotice: (
      id: string,
      notice: string
    ) => Effect.Effect<SessionRefund | null, SqlError>;
    /** Succeeded refunds whose money went back in `[from, to)` (tax report). */
    listRefundedBetween: (range: {
      from: Date;
      to: Date;
    }) => Effect.Effect<Array<SessionRefund>, SqlError>;

    listRecoveries: (filter: {
      helperUserId?: string;
      sessionId?: string;
      statuses?: ReadonlyArray<HelperRecovery['status']>;
    }) => Effect.Effect<Array<HelperRecovery>, SqlError>;

    /** Captured cycles (or, Tier 3 step 3, cycles with an extra session
     * charged on its own payment) whose transfer time has passed and that have no
     * first transfer yet. */
    listCyclesDueForTransfer: (now: Date) => Effect.Effect<Array<TransferableCycle>, SqlError>;
    /** Inserts unless (cycle, sequence) exists; resolves the row on file. */
    ensureTransfer: (input: HelperTransferInsert) => Effect.Effect<HelperTransfer, SqlError>;
    findTransfer: (id: string) => Effect.Effect<HelperTransfer | null, SqlError>;
    findTransferByProviderReference: (
      reference: string
    ) => Effect.Effect<HelperTransfer | null, SqlError>;
    listTransfers: (filter: {
      cycleId?: string;
      contractId?: string;
      helperUserId?: string;
      statuses?: ReadonlyArray<HelperTransferStatus>;
    }) => Effect.Effect<Array<HelperTransfer>, SqlError>;
    advanceTransfer: (
      id: string,
      input: { from: ReadonlyArray<HelperTransferStatus>; set: Patch<HelperTransfer> }
    ) => Effect.Effect<HelperTransfer | null, SqlError>;
    /** Fixes what a transfer pays: compare-and-set on its status, its items,
     * the recoveries it deducts and their ledger entries — one transaction.
     * Null (nothing written) when the transfer or a recovery had moved. */
    fixTransfer: (
      id: string,
      input: FixTransferInput
    ) => Effect.Effect<HelperTransfer | null, SqlError>;
    listTransferItems: (filter: {
      transferIds?: ReadonlyArray<string>;
      sessionIds?: ReadonlyArray<string>;
    }) => Effect.Effect<Array<HelperTransferItem>, SqlError>;
    appendTransferNotice: (
      id: string,
      notice: string
    ) => Effect.Effect<HelperTransfer | null, SqlError>;
    /** Every `sent` transfer of a helper made at or before `before`, moved
     * to `paid` (a bank payout was paid) — the APPROXIMATE match by timing
     * (spec §13.4), labelled so; the exact match is the reconciliation
     * repo's. Resolves how many moved. */
    markHelperTransfersPaid: (
      helperUserId: string,
      before: Date,
      paidAt: Date,
      payoutReference?: string | null
    ) => Effect.Effect<number, SqlError>;

    /** Records a manual payout (pending approval) with its audit row.
     * Null when the transfer already has a live one. */
    recordManualPayout: (
      input: ManualPayoutInsert,
      audit: BillingAuditInsert
    ) => Effect.Effect<ManualPayout | null, SqlError>;
    /** Approves (the transfer becomes `manual_paid`, final) or rejects a
     * pending manual payout, with its audit row and ledger entries — one
     * transaction. Null when it had already been decided (or the transfer
     * had moved on). */
    decideManualPayout: (
      id: string,
      input: {
        decision: 'approved' | 'rejected';
        actorUserId: string;
        note: string | null;
        at: Date;
        ledger: ReadonlyArray<BillingLedgerInsert>;
      },
      audit: BillingAuditInsert
    ) => Effect.Effect<ManualPayout | null, SqlError>;
    listManualPayouts: (filter: {
      transferIds?: ReadonlyArray<string>;
      statuses?: ReadonlyArray<ManualPayout['status']>;
    }) => Effect.Effect<Array<ManualPayout>, SqlError>;

    appendAudit: (event: BillingAuditInsert) => Effect.Effect<void, SqlError>;
    listAudit: (
      entity: string,
      entityId: string
    ) => Effect.Effect<Array<BillingAuditEvent>, SqlError>;
  }
>() {}

/** SQLSTATE 23514 raised by the refund-limit trigger, however deeply the
 * driver nested it. */
const isRefundLimitViolation = (error: SqlError) => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === '23514' && String(record.message ?? '').includes('session_refunds')) {
      return String(record.message);
    }
    current = record.cause;
  }
  return null;
};

class TxAbort extends Data.TaggedError('TxAbort')<{}> {}

export const SessionMoneyRepoLive = Layer.effect(
  SessionMoneyRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const insertLedger = (entries: ReadonlyArray<BillingLedgerInsert>) =>
      entries.length === 0
        ? Effect.void
        : db
            .insert(billingLedgerEntry)
            .values([...entries])
            .onConflictDoNothing({ target: billingLedgerEntry.entryKey })
            .pipe(Effect.asVoid);

    const findRefundByKey = (key: string) =>
      db
        .select()
        .from(sessionRefund)
        .where(eq(sessionRefund.refundKey, key))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    const findRecoveryByKey = (key: string) =>
      db
        .select()
        .from(helperRecovery)
        .where(eq(helperRecovery.recoveryKey, key))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    const findTransfer = (id: string) =>
      db
        .select()
        .from(helperTransfer)
        .where(eq(helperTransfer.id, id))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    return {
      applyEffect: (input) =>
        sqlClient
          .withTransaction(
            Effect.gen(function* () {
              const refundRows = input.refund
                ? yield* db
                    .insert(sessionRefund)
                    .values(input.refund)
                    .onConflictDoNothing({ target: sessionRefund.refundKey })
                    .returning()
                : [];
              const refundCreated = refundRows.length > 0;
              const refund: SessionRefund | null = input.refund
                ? (refundRows[0] ?? (yield* findRefundByKey(input.refund.refundKey)))
                : null;
              const recoveryRows = input.recovery
                ? yield* db
                    .insert(helperRecovery)
                    .values(input.recovery)
                    .onConflictDoNothing({ target: helperRecovery.recoveryKey })
                    .returning()
                : [];
              const recovery: HelperRecovery | null = input.recovery
                ? (recoveryRows[0] ?? (yield* findRecoveryByKey(input.recovery.recoveryKey)))
                : null;
              yield* db
                .insert(sessionMoneyEffect)
                .values(input.effect)
                .onConflictDoUpdate({
                  target: sessionMoneyEffect.sessionId,
                  set: { ...input.effect, updatedAt: new Date() }
                });
              yield* insertLedger(input.ledger);
              return { refund, refundCreated, recovery } satisfies ApplyEffectResult;
            })
          )
          .pipe(
            Effect.mapError((error): SqlError | RefundLimitError => {
              const detail = isRefundLimitViolation(error);
              return detail !== null && input.refund
                ? new RefundLimitError({ refundKey: input.refund.refundKey, detail })
                : error;
            })
          ),
      listEffects: (contractId) =>
        db.select().from(sessionMoneyEffect).where(eq(sessionMoneyEffect.contractId, contractId)),

      listRefunds: (filter) =>
        db
          .select()
          .from(sessionRefund)
          .where(
            and(
              filter.contractId ? eq(sessionRefund.contractId, filter.contractId) : undefined,
              filter.sessionId ? eq(sessionRefund.sessionId, filter.sessionId) : undefined,
              filter.paymentIds
                ? filter.paymentIds.length === 0
                  ? sql`false`
                  : inArray(sessionRefund.paymentId, [...filter.paymentIds])
                : undefined,
              filter.statuses ? inArray(sessionRefund.status, [...filter.statuses]) : undefined
            )
          )
          .orderBy(asc(sessionRefund.createdAt)),
      findRefund: (id) =>
        db
          .select()
          .from(sessionRefund)
          .where(eq(sessionRefund.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findRefundByProviderReference: (reference) =>
        db
          .select()
          .from(sessionRefund)
          .where(eq(sessionRefund.providerReference, reference))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      advanceRefund: (id, input) =>
        db
          .update(sessionRefund)
          .set({ ...input.set, updatedAt: new Date() })
          .where(and(eq(sessionRefund.id, id), inArray(sessionRefund.status, [...input.from])))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      appendRefundNotice: (id, notice) =>
        db
          .update(sessionRefund)
          .set({
            noticesSent: sql`${sessionRefund.noticesSent} || ${JSON.stringify([notice])}::jsonb`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(sessionRefund.id, id),
              sql`NOT (${sessionRefund.noticesSent} @> ${JSON.stringify([notice])}::jsonb)`
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listRefundedBetween: ({ from, to }) =>
        db
          .select()
          .from(sessionRefund)
          .where(
            and(
              eq(sessionRefund.status, 'succeeded'),
              sql`${sessionRefund.refundedAt} >= ${from}`,
              sql`${sessionRefund.refundedAt} < ${to}`
            )
          ),

      listRecoveries: (filter) =>
        db
          .select()
          .from(helperRecovery)
          .where(
            and(
              filter.helperUserId
                ? eq(helperRecovery.helperUserId, filter.helperUserId)
                : undefined,
              filter.sessionId ? eq(helperRecovery.sessionId, filter.sessionId) : undefined,
              filter.statuses ? inArray(helperRecovery.status, [...filter.statuses]) : undefined
            )
          )
          .orderBy(asc(helperRecovery.createdAt)),

      listCyclesDueForTransfer: (now) =>
        db
          .select({ cycle: contractCycle, helperUserId: contract.providerUserId })
          .from(contractCycle)
          .innerJoin(contract, eq(contract.id, contractCycle.contractId))
          .leftJoin(
            helperTransfer,
            and(eq(helperTransfer.cycleId, contractCycle.id), eq(helperTransfer.sequence, 1))
          )
          .where(
            and(
              // Tier 3 step 3: a cycle that was never captured (nothing to
              // bill, carried…) still transfers an extra session charged on
              // its own payment.
              or(
                eq(contractCycle.status, 'captured'),
                sql`exists (select 1 from ${contractSessionCharge} where ${contractSessionCharge.cycleId} = ${contractCycle.id})`
              ),
              lte(contractCycle.transferAt, now),
              isNull(helperTransfer.id)
            )
          )
          .orderBy(asc(contractCycle.transferAt)),
      ensureTransfer: (input) =>
        db
          .insert(helperTransfer)
          .values(input)
          .onConflictDoNothing({ target: [helperTransfer.cycleId, helperTransfer.sequence] })
          .pipe(
            Effect.zipRight(
              db
                .select()
                .from(helperTransfer)
                .where(
                  and(
                    eq(helperTransfer.cycleId, input.cycleId),
                    eq(helperTransfer.sequence, input.sequence)
                  )
                )
                .limit(1)
            ),
            Effect.map((rows) => rows[0]!)
          ),
      findTransfer,
      findTransferByProviderReference: (reference) =>
        db
          .select()
          .from(helperTransfer)
          .where(eq(helperTransfer.providerReference, reference))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listTransfers: (filter) =>
        db
          .select()
          .from(helperTransfer)
          .where(
            and(
              filter.cycleId ? eq(helperTransfer.cycleId, filter.cycleId) : undefined,
              filter.contractId ? eq(helperTransfer.contractId, filter.contractId) : undefined,
              filter.helperUserId
                ? eq(helperTransfer.helperUserId, filter.helperUserId)
                : undefined,
              filter.statuses ? inArray(helperTransfer.status, [...filter.statuses]) : undefined
            )
          )
          .orderBy(desc(helperTransfer.dueAt), asc(helperTransfer.sequence)),
      advanceTransfer: (id, input) =>
        db
          .update(helperTransfer)
          .set({ ...input.set, updatedAt: new Date() })
          .where(and(eq(helperTransfer.id, id), inArray(helperTransfer.status, [...input.from])))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      fixTransfer: (id, input) =>
        sqlClient
          .withTransaction(
            Effect.gen(function* () {
              const moved = (yield* db
                .update(helperTransfer)
                .set({ ...input.set, updatedAt: new Date() })
                .where(
                  and(eq(helperTransfer.id, id), inArray(helperTransfer.status, [...input.from]))
                )
                .returning())[0];
              if (!moved) return yield* Effect.fail(new TxAbort());
              if (input.items.length > 0) {
                yield* db
                  .insert(helperTransferItem)
                  .values(input.items.map((item) => ({ ...item, transferId: id })));
              }
              for (const recovery of input.recoveries) {
                const updated = yield* db
                  .update(helperRecovery)
                  .set({
                    recoveredCents: recovery.recoveredCents,
                    status: sql`case when ${recovery.recoveredCents} >= ${helperRecovery.amountCents} then 'repaid'::app_db.helper_recovery_status else ${helperRecovery.status} end`,
                    updatedAt: new Date()
                  })
                  .where(
                    and(
                      eq(helperRecovery.id, recovery.id),
                      eq(helperRecovery.recoveredCents, recovery.fromRecoveredCents)
                    )
                  )
                  .returning({ id: helperRecovery.id });
                if (updated.length === 0) return yield* Effect.fail(new TxAbort());
              }
              yield* insertLedger(input.ledger);
              return moved;
            })
          )
          .pipe(Effect.catchTag('TxAbort', () => Effect.succeed(null))),
      listTransferItems: (filter) =>
        filter.transferIds?.length === 0 || filter.sessionIds?.length === 0
          ? Effect.succeed([])
          : db
              .select()
              .from(helperTransferItem)
              .where(
                and(
                  filter.transferIds
                    ? inArray(helperTransferItem.transferId, [...filter.transferIds])
                    : undefined,
                  filter.sessionIds
                    ? inArray(helperTransferItem.sessionId, [...filter.sessionIds])
                    : undefined
                )
              )
              .orderBy(asc(helperTransferItem.createdAt)),
      appendTransferNotice: (id, notice) =>
        db
          .update(helperTransfer)
          .set({
            noticesSent: sql`${helperTransfer.noticesSent} || ${JSON.stringify([notice])}::jsonb`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(helperTransfer.id, id),
              sql`NOT (${helperTransfer.noticesSent} @> ${JSON.stringify([notice])}::jsonb)`
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      markHelperTransfersPaid: (helperUserId, before, paidAt, payoutReference = null) =>
        db
          .update(helperTransfer)
          .set({
            status: 'paid',
            paidAt,
            payoutReference,
            payoutMatch: 'approximate',
            updatedAt: new Date()
          })
          .where(
            and(
              eq(helperTransfer.helperUserId, helperUserId),
              eq(helperTransfer.status, 'sent'),
              lte(helperTransfer.sentAt, before)
            )
          )
          .returning({ id: helperTransfer.id })
          .pipe(Effect.map((rows) => rows.length)),

      recordManualPayout: (input, audit) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const rows = yield* db
              .insert(manualPayout)
              .values(input)
              .onConflictDoNothing()
              .returning();
            const row = rows[0];
            if (!row) return null;
            yield* db.insert(billingAuditEvent).values({ ...audit, entityId: row.id, after: row });
            return row;
          })
        ),
      decideManualPayout: (id, input, audit) =>
        sqlClient
          .withTransaction(
            Effect.gen(function* () {
              const row = (yield* db
                .update(manualPayout)
                .set({
                  status: input.decision,
                  decidedByUserId: input.actorUserId,
                  decidedAt: input.at,
                  decisionNote: input.note,
                  updatedAt: new Date()
                })
                .where(and(eq(manualPayout.id, id), eq(manualPayout.status, 'pending_approval')))
                .returning())[0];
              if (!row) return yield* Effect.fail(new TxAbort());
              if (input.decision === 'approved') {
                const settled = yield* db
                  .update(helperTransfer)
                  .set({ status: 'manual_paid', paidAt: input.at, updatedAt: new Date() })
                  .where(
                    and(
                      eq(helperTransfer.id, row.transferId),
                      inArray(helperTransfer.status, ['manual_review', 'failed'])
                    )
                  )
                  .returning({ id: helperTransfer.id });
                if (settled.length === 0) return yield* Effect.fail(new TxAbort());
                yield* insertLedger(input.ledger);
              }
              yield* db
                .insert(billingAuditEvent)
                .values({ ...audit, entityId: row.id, after: row });
              return row;
            })
          )
          .pipe(Effect.catchTag('TxAbort', () => Effect.succeed(null))),
      listManualPayouts: (filter) =>
        filter.transferIds?.length === 0
          ? Effect.succeed([])
          : db
              .select()
              .from(manualPayout)
              .where(
                and(
                  filter.transferIds
                    ? inArray(manualPayout.transferId, [...filter.transferIds])
                    : undefined,
                  filter.statuses ? inArray(manualPayout.status, [...filter.statuses]) : undefined
                )
              )
              .orderBy(asc(manualPayout.createdAt)),

      appendAudit: (event) => db.insert(billingAuditEvent).values(event).pipe(Effect.asVoid),
      listAudit: (entity, entityId) =>
        db
          .select()
          .from(billingAuditEvent)
          .where(
            and(eq(billingAuditEvent.entity, entity), eq(billingAuditEvent.entityId, entityId))
          )
          .orderBy(asc(billingAuditEvent.createdAt))
    };
  })
);

export const SessionMoneyRepoDefault = SessionMoneyRepoLive.pipe(Layer.provide(DrizzleLive));

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics (limits included), for
// unit tests.

/** UUID-shaped, like the database's, so route validation accepts them. */
const nextId = (_kind: string) => crypto.randomUUID();

export const makeInMemorySessionMoneyRepo = (
  options: {
    /** The billing repo's state: its charges (the refund limits), cycles
     * (transfers due) and ledger (entries are appended there). */
    billing?: {
      charges: Array<SessionCharge>;
      cycles: Array<ContractCycle>;
      ledger: Array<BillingLedgerEntry>;
    };
    /** What a payment captured (the per-payment refund limit). */
    capturedOf?: (paymentId: string) => number | null;
    /** contractId → the helper's user id (transfers due). */
    helpers?: Record<string, string>;
    clock?: () => Date;
  } = {}
) => {
  const now = options.clock ?? (() => new Date());
  const billing = options.billing ?? { charges: [], cycles: [], ledger: [] };
  const state = {
    refunds: [] as Array<SessionRefund>,
    recoveries: [] as Array<HelperRecovery>,
    transfers: [] as Array<HelperTransfer>,
    items: [] as Array<HelperTransferItem>,
    manualPayouts: [] as Array<ManualPayout>,
    effects: new Map<string, SessionMoneyEffect>(),
    audit: [] as Array<BillingAuditEvent>,
    ledger: billing.ledger
  };

  const appendLedger = (entries: ReadonlyArray<BillingLedgerInsert>) => {
    for (const entry of entries) {
      if (state.ledger.some((row) => row.entryKey === entry.entryKey)) continue;
      state.ledger.push({
        cycleId: null,
        sessionId: null,
        paymentId: null,
        label: null,
        ...entry,
        id: nextId('ledger'),
        createdAt: now()
      } as BillingLedgerEntry);
    }
  };

  const live = (row: SessionRefund) => row.status !== 'cancelled';
  const limitError = (refund: SessionRefundInsert, ignoreId?: string) => {
    const charge = billing.charges.find(
      (row) => row.sessionId === refund.sessionId && row.paymentId === refund.paymentId
    );
    if (!charge) return 'session has no frozen charge on this payment';
    const others = state.refunds.filter((row) => live(row) && row.id !== ignoreId);
    const bySession = others
      .filter((row) => row.sessionId === refund.sessionId)
      .reduce((t, row) => t + row.totalCents, 0);
    if (bySession + refund.totalCents > charge.familyTotalCents) {
      return 'refunds for the session would exceed its charge';
    }
    const captured = options.capturedOf?.(refund.paymentId) ?? Number.POSITIVE_INFINITY;
    const byPayment = others
      .filter((row) => row.paymentId === refund.paymentId)
      .reduce((t, row) => t + row.totalCents, 0);
    if (byPayment + refund.totalCents > captured) {
      return 'refunds on the payment would exceed what it captured';
    }
    return null;
  };

  const patchRow = <T extends { id: string; updatedAt: Date }>(
    rows: Array<T>,
    id: string,
    accept: (row: T) => boolean,
    set: Partial<T>
  ): T | null => {
    const index = rows.findIndex((row) => row.id === id);
    const row = rows[index];
    if (!row || !accept(row)) return null;
    const next = { ...row, ...set, updatedAt: now() };
    rows[index] = next;
    return next;
  };

  const service: Context.Tag.Service<SessionMoneyRepo> = {
    applyEffect: (input) =>
      Effect.suspend(() => {
        let refund: SessionRefund | null = null;
        let refundCreated = false;
        if (input.refund) {
          refund = state.refunds.find((row) => row.refundKey === input.refund!.refundKey) ?? null;
          if (!refund) {
            const refused = limitError(input.refund);
            if (refused) {
              return Effect.fail(
                new RefundLimitError({ refundKey: input.refund.refundKey, detail: refused })
              );
            }
            refund = {
              commissionCents: 0,
              commissionTaxLines: [],
              status: 'pending',
              attempts: 0,
              providerReference: null,
              failureReason: null,
              noticesSent: [],
              refundedAt: null,
              resolvedByUserId: null,
              resolvedNote: null,
              handledAt: null,
              ...input.refund,
              id: nextId('refund'),
              createdAt: now(),
              updatedAt: now()
            } as SessionRefund;
            state.refunds.push(refund);
            refundCreated = true;
          }
        }
        let recovery: HelperRecovery | null = null;
        if (input.recovery) {
          recovery =
            state.recoveries.find((row) => row.recoveryKey === input.recovery!.recoveryKey) ?? null;
          if (!recovery) {
            recovery = {
              resolutionId: null,
              recoveredCents: 0,
              status: 'outstanding',
              ...input.recovery,
              id: nextId('recovery'),
              createdAt: now(),
              updatedAt: now()
            } as HelperRecovery;
            state.recoveries.push(recovery);
          }
        }
        state.effects.set(input.effect.sessionId, {
          resolutionId: null,
          familyRefundCents: 0,
          helperOwedCents: 0,
          ...input.effect,
          updatedAt: now()
        } as SessionMoneyEffect);
        appendLedger(input.ledger);
        return Effect.succeed({ refund, refundCreated, recovery });
      }),
    listEffects: (contractId) =>
      Effect.sync(() => [...state.effects.values()].filter((row) => row.contractId === contractId)),

    listRefunds: (filter) =>
      Effect.sync(() =>
        state.refunds.filter(
          (row) =>
            (!filter.contractId || row.contractId === filter.contractId) &&
            (!filter.sessionId || row.sessionId === filter.sessionId) &&
            (!filter.paymentIds || filter.paymentIds.includes(row.paymentId)) &&
            (!filter.statuses || filter.statuses.includes(row.status))
        )
      ),
    findRefund: (id) => Effect.sync(() => state.refunds.find((row) => row.id === id) ?? null),
    findRefundByProviderReference: (reference) =>
      Effect.sync(() => state.refunds.find((row) => row.providerReference === reference) ?? null),
    advanceRefund: (id, input) =>
      Effect.sync(() =>
        patchRow<SessionRefund>(
          state.refunds,
          id,
          (row) => input.from.includes(row.status),
          input.set
        )
      ),
    appendRefundNotice: (id, notice) =>
      Effect.sync(() => {
        const row = state.refunds.find((r) => r.id === id);
        if (!row || row.noticesSent.includes(notice)) return null;
        return patchRow<SessionRefund>(state.refunds, id, () => true, {
          noticesSent: [...row.noticesSent, notice]
        });
      }),
    listRefundedBetween: ({ from, to }) =>
      Effect.sync(() =>
        state.refunds.filter(
          (row) =>
            row.status === 'succeeded' &&
            row.refundedAt !== null &&
            row.refundedAt >= from &&
            row.refundedAt < to
        )
      ),

    listRecoveries: (filter) =>
      Effect.sync(() =>
        state.recoveries.filter(
          (row) =>
            (!filter.helperUserId || row.helperUserId === filter.helperUserId) &&
            (!filter.sessionId || row.sessionId === filter.sessionId) &&
            (!filter.statuses || filter.statuses.includes(row.status))
        )
      ),

    listCyclesDueForTransfer: (at) =>
      Effect.sync(() =>
        billing.cycles
          .filter(
            (cycle) =>
              (cycle.status === 'captured' ||
                billing.charges.some((row) => row.cycleId === cycle.id)) &&
              cycle.transferAt <= at &&
              !state.transfers.some((row) => row.cycleId === cycle.id && row.sequence === 1)
          )
          .sort((a, b) => a.transferAt.getTime() - b.transferAt.getTime())
          .map((cycle) => ({
            cycle,
            helperUserId: options.helpers?.[cycle.contractId] ?? 'helper-1'
          }))
      ),
    ensureTransfer: (input) =>
      Effect.sync(() => {
        const existing = state.transfers.find(
          (row) => row.cycleId === input.cycleId && row.sequence === input.sequence
        );
        if (existing) return existing;
        const row = {
          grossCents: null,
          recoveredCents: null,
          amountCents: null,
          attempts: 0,
          providerReference: null,
          sourceReference: null,
          failureReason: null,
          noticesSent: [],
          fixedAt: null,
          sentAt: null,
          paidAt: null,
          payoutReference: null,
          payoutMatch: null,
          ...input,
          id: nextId('transfer'),
          createdAt: now(),
          updatedAt: now()
        } as HelperTransfer;
        state.transfers.push(row);
        return row;
      }),
    findTransfer: (id) => Effect.sync(() => state.transfers.find((row) => row.id === id) ?? null),
    findTransferByProviderReference: (reference) =>
      Effect.sync(() => state.transfers.find((row) => row.providerReference === reference) ?? null),
    listTransfers: (filter) =>
      Effect.sync(() =>
        state.transfers
          .filter(
            (row) =>
              (!filter.cycleId || row.cycleId === filter.cycleId) &&
              (!filter.contractId || row.contractId === filter.contractId) &&
              (!filter.helperUserId || row.helperUserId === filter.helperUserId) &&
              (!filter.statuses || filter.statuses.includes(row.status))
          )
          .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime() || a.sequence - b.sequence)
      ),
    advanceTransfer: (id, input) =>
      Effect.sync(() => {
        const row = state.transfers.find((r) => r.id === id);
        // The database refuses to reopen a manually paid transfer.
        if (
          row?.status === 'manual_paid' &&
          input.set.status &&
          input.set.status !== 'manual_paid'
        ) {
          throw new Error('helper_transfers: paid manually and final');
        }
        return patchRow<HelperTransfer>(
          state.transfers,
          id,
          (r) => input.from.includes(r.status),
          input.set
        );
      }),
    fixTransfer: (id, input) =>
      Effect.sync(() => {
        const row = state.transfers.find((r) => r.id === id);
        if (!row || !input.from.includes(row.status)) return null;
        for (const recovery of input.recoveries) {
          const current = state.recoveries.find((r) => r.id === recovery.id);
          if (!current || current.recoveredCents !== recovery.fromRecoveredCents) return null;
        }
        for (const recovery of input.recoveries) {
          const current = state.recoveries.find((r) => r.id === recovery.id)!;
          patchRow<HelperRecovery>(state.recoveries, recovery.id, () => true, {
            recoveredCents: recovery.recoveredCents,
            status: recovery.recoveredCents >= current.amountCents ? 'repaid' : current.status
          });
        }
        for (const item of input.items) {
          state.items.push({
            sessionId: null,
            recoveryId: null,
            ...item,
            transferId: id,
            id: nextId('item'),
            createdAt: now()
          } as HelperTransferItem);
        }
        appendLedger(input.ledger);
        return patchRow<HelperTransfer>(state.transfers, id, () => true, input.set);
      }),
    listTransferItems: (filter) =>
      Effect.sync(() =>
        state.items.filter(
          (row) =>
            (!filter.transferIds || filter.transferIds.includes(row.transferId)) &&
            (!filter.sessionIds ||
              (row.sessionId !== null && filter.sessionIds.includes(row.sessionId)))
        )
      ),
    appendTransferNotice: (id, notice) =>
      Effect.sync(() => {
        const row = state.transfers.find((r) => r.id === id);
        if (!row || row.noticesSent.includes(notice)) return null;
        return patchRow<HelperTransfer>(state.transfers, id, () => true, {
          noticesSent: [...row.noticesSent, notice]
        });
      }),
    markHelperTransfersPaid: (helperUserId, before, paidAt, payoutReference = null) =>
      Effect.sync(() => {
        let moved = 0;
        for (const row of state.transfers) {
          if (
            row.helperUserId === helperUserId &&
            row.status === 'sent' &&
            row.sentAt !== null &&
            row.sentAt <= before
          ) {
            patchRow<HelperTransfer>(state.transfers, row.id, () => true, {
              status: 'paid',
              paidAt,
              payoutReference,
              payoutMatch: 'approximate'
            });
            moved += 1;
          }
        }
        return moved;
      }),

    recordManualPayout: (input, audit) =>
      Effect.sync(() => {
        if (
          state.manualPayouts.some(
            (row) => row.transferId === input.transferId && row.status !== 'rejected'
          )
        ) {
          return null;
        }
        const row: ManualPayout = {
          ...input,
          id: nextId('manual'),
          status: 'pending_approval',
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          createdAt: now(),
          updatedAt: now()
        };
        state.manualPayouts.push(row);
        state.audit.push({
          note: null,
          before: null,
          actorUserId: null,
          ...audit,
          entityId: row.id,
          after: row,
          id: nextId('audit'),
          createdAt: now()
        } as BillingAuditEvent);
        return row;
      }),
    decideManualPayout: (id, input, audit) =>
      Effect.sync(() => {
        const row = state.manualPayouts.find((r) => r.id === id);
        if (!row || row.status !== 'pending_approval') return null;
        if (input.decision === 'approved') {
          // The database refuses approval by the admin who recorded it.
          if (input.actorUserId === row.recordedByUserId) {
            throw new Error('manual_payouts_second_admin_check');
          }
          const transfer = state.transfers.find((t) => t.id === row.transferId);
          if (!transfer || !['manual_review', 'failed'].includes(transfer.status)) return null;
          patchRow<HelperTransfer>(state.transfers, transfer.id, () => true, {
            status: 'manual_paid',
            paidAt: input.at
          });
          appendLedger(input.ledger);
        }
        const next = patchRow<ManualPayout>(state.manualPayouts, id, () => true, {
          status: input.decision,
          decidedByUserId: input.actorUserId,
          decidedAt: input.at,
          decisionNote: input.note
        })!;
        state.audit.push({
          note: null,
          before: null,
          actorUserId: null,
          ...audit,
          entityId: next.id,
          after: next,
          id: nextId('audit'),
          createdAt: now()
        } as BillingAuditEvent);
        return next;
      }),
    listManualPayouts: (filter) =>
      Effect.sync(() =>
        state.manualPayouts.filter(
          (row) =>
            (!filter.transferIds || filter.transferIds.includes(row.transferId)) &&
            (!filter.statuses || filter.statuses.includes(row.status))
        )
      ),

    appendAudit: (event) =>
      Effect.sync(() => {
        state.audit.push({
          note: null,
          before: null,
          after: null,
          actorUserId: null,
          ...event,
          id: nextId('audit'),
          createdAt: now()
        } as BillingAuditEvent);
      }),
    listAudit: (entity, entityId) =>
      Effect.sync(() =>
        state.audit.filter((row) => row.entity === entity && row.entityId === entityId)
      )
  };
  return { layer: Layer.succeed(SessionMoneyRepo, service), state, service };
};
