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
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Data, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  billingAuditEvent,
  billingLedgerEntry,
  cardDispute,
  cardDisputeEvidenceSubmission,
  cardDisputeSession,
  contractSessionCharge,
  helperRecovery
} from '../schema';
import type { BillingLedgerEntry, BillingLedgerInsert, SessionCharge } from './contract-billing-repo';
import type {
  BillingAuditEvent,
  BillingAuditInsert,
  HelperRecovery,
  HelperRecoveryInsert,
  SessionCardDispute
} from './session-money-repo';

/**
 * Card disputes (chargebacks, Tier 3 step 4 — spec 2026-10-28 §15).
 *
 * A dispute row is created once per provider dispute, with the sessions its
 * charge paid for, in ONE insert-if-absent transaction (a duplicate or
 * concurrent webhook finds the row on file); afterwards it is only brought
 * in step with what the provider reports. An allocation of a lost dispute's
 * session is decided once (compare-and-set on `allocation is null`, and a
 * trigger refuses changing it), with its recovery, ledger entries and audit
 * row in the same transaction. Evidence submissions are append-only.
 */

export type CardDispute = InferSelectModel<typeof cardDispute>;
export type CardDisputeInsert = Omit<
  InferInsertModel<typeof cardDispute>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type CardDisputeTriage = CardDispute['triage'];
export type CardDisputeSession = InferSelectModel<typeof cardDisputeSession>;
export type CardDisputeSessionInsert = Omit<
  InferInsertModel<typeof cardDisputeSession>,
  'disputeId' | 'createdAt'
>;
export type CardDisputeAllocation = NonNullable<CardDisputeSession['allocation']>;
export type CardDisputeEvidenceSubmission = InferSelectModel<typeof cardDisputeEvidenceSubmission>;
export type CardDisputeEvidenceSubmissionInsert = Omit<
  InferInsertModel<typeof cardDisputeEvidenceSubmission>,
  'id' | 'createdAt'
>;

/** The provider's statuses that end a dispute. */
export const closedCardDisputeStatuses: ReadonlyArray<string> = [
  'won',
  'lost',
  'warning_closed',
  'prevented'
];

type Patch<T> = Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>;

/** An extra session's charge authorisation (Tier 3 step 3), for evidence. */
export type ExtraSessionAuthorisation = {
  sessionId: string;
  authorisedAt: Date | null;
  authorisedCents: number | null;
};

export type AllocateSessionInput = {
  disputeId: string;
  sessionId: string;
  allocation: CardDisputeAllocation;
  reason: string;
  helperForfeitCents: number;
  actorUserId: string;
  at: Date;
  /** The recovery from the helper's future transfers (pay already sent). */
  recovery: HelperRecoveryInsert | null;
  ledger: ReadonlyArray<BillingLedgerInsert>;
  audit: BillingAuditInsert;
};

export class CardDisputeRepo extends Context.Tag('@repo/db/CardDisputeRepo')<
  CardDisputeRepo,
  {
    /** Inserts the dispute and its sessions unless the provider's dispute is
     * on file; resolves the row on file and whether this call created it. */
    ensure: (input: {
      dispute: CardDisputeInsert;
      sessions: ReadonlyArray<CardDisputeSessionInsert>;
    }) => Effect.Effect<{ dispute: CardDispute; created: boolean }, SqlError>;
    findById: (id: string) => Effect.Effect<CardDispute | null, SqlError>;
    findByProviderReference: (
      provider: string,
      reference: string
    ) => Effect.Effect<CardDispute | null, SqlError>;
    list: (filter: {
      triage?: ReadonlyArray<CardDisputeTriage>;
      familyUserId?: string;
      paymentId?: string;
      /** true: not closed; false: closed. */
      open?: boolean;
    }) => Effect.Effect<Array<CardDispute>, SqlError>;
    /** Writes what the provider reports (and the derived triage). */
    update: (id: string, set: Patch<CardDispute>) => Effect.Effect<CardDispute | null, SqlError>;
    /** Compare-and-set on the triage. */
    advanceTriage: (
      id: string,
      input: { from: ReadonlyArray<CardDisputeTriage>; set: Patch<CardDispute> }
    ) => Effect.Effect<CardDispute | null, SqlError>;
    /** Appends a notice once; null when it was already recorded. */
    appendNotice: (id: string, notice: string) => Effect.Effect<CardDispute | null, SqlError>;
    listSessions: (filter: {
      disputeIds?: ReadonlyArray<string>;
      sessionIds?: ReadonlyArray<string>;
    }) => Effect.Effect<Array<CardDisputeSession>, SqlError>;
    /** Decides one session of a lost dispute, once: its allocation, the
     * recovery, the ledger entries and the audit row — one transaction.
     * Null (nothing written) when it was already allocated. */
    allocateSession: (
      input: AllocateSessionInput
    ) => Effect.Effect<CardDisputeSession | null, SqlError>;
    /** Records what was sent to the provider and updates the dispute — one
     * transaction, with its audit row. */
    recordSubmission: (
      input: CardDisputeEvidenceSubmissionInsert,
      set: Patch<CardDispute>,
      audit: BillingAuditInsert
    ) => Effect.Effect<CardDisputeEvidenceSubmission, SqlError>;
    listSubmissions: (
      disputeId: string
    ) => Effect.Effect<Array<CardDisputeEvidenceSubmission>, SqlError>;
    /** The frozen per-session split rows a payment paid (a cycle's charge,
     * or an extra session's own payment). */
    listChargesForPayment: (paymentId: string) => Effect.Effect<Array<SessionCharge>, SqlError>;
    /** The family's explicit authorisation of each extra session's charge
     * (Tier 3 step 3), when that table exists. */
    listExtraSessionAuthorisations: (
      sessionIds: ReadonlyArray<string>
    ) => Effect.Effect<Array<ExtraSessionAuthorisation>, SqlError>;
  }
>() {}

class TxAbort extends Data.TaggedError('TxAbort')<{}> {}

export const CardDisputeRepoLive = Layer.effect(
  CardDisputeRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const findByProviderReference = (provider: string, reference: string) =>
      db
        .select()
        .from(cardDispute)
        .where(
          and(eq(cardDispute.provider, provider), eq(cardDispute.providerReference, reference))
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    return {
      ensure: (input) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const inserted = yield* db
              .insert(cardDispute)
              .values(input.dispute)
              .onConflictDoNothing({
                target: [cardDispute.provider, cardDispute.providerReference]
              })
              .returning();
            const created = inserted[0];
            if (!created) {
              const existing = yield* findByProviderReference(
                input.dispute.provider,
                input.dispute.providerReference
              );
              return { dispute: existing!, created: false };
            }
            if (input.sessions.length > 0) {
              yield* db
                .insert(cardDisputeSession)
                .values(input.sessions.map((row) => ({ ...row, disputeId: created.id })));
            }
            return { dispute: created, created: true };
          })
        ),
      findById: (id) =>
        db
          .select()
          .from(cardDispute)
          .where(eq(cardDispute.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findByProviderReference,
      list: (filter) =>
        db
          .select()
          .from(cardDispute)
          .where(
            and(
              filter.triage ? inArray(cardDispute.triage, [...filter.triage]) : undefined,
              filter.familyUserId ? eq(cardDispute.familyUserId, filter.familyUserId) : undefined,
              filter.paymentId ? eq(cardDispute.paymentId, filter.paymentId) : undefined,
              filter.open === true
                ? isNull(cardDispute.closedAt)
                : filter.open === false
                  ? sql`${cardDispute.closedAt} is not null`
                  : undefined
            )
          )
          .orderBy(desc(cardDispute.providerCreatedAt)),
      update: (id, set) =>
        db
          .update(cardDispute)
          .set({ ...set, updatedAt: new Date() })
          .where(eq(cardDispute.id, id))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      advanceTriage: (id, input) =>
        db
          .update(cardDispute)
          .set({ ...input.set, updatedAt: new Date() })
          .where(and(eq(cardDispute.id, id), inArray(cardDispute.triage, [...input.from])))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      appendNotice: (id, notice) =>
        db
          .update(cardDispute)
          .set({
            noticesSent: sql`${cardDispute.noticesSent} || ${JSON.stringify([notice])}::jsonb`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(cardDispute.id, id),
              sql`NOT (${cardDispute.noticesSent} @> ${JSON.stringify([notice])}::jsonb)`
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listSessions: (filter) =>
        filter.disputeIds?.length === 0 || filter.sessionIds?.length === 0
          ? Effect.succeed([])
          : db
              .select()
              .from(cardDisputeSession)
              .where(
                and(
                  filter.disputeIds
                    ? inArray(cardDisputeSession.disputeId, [...filter.disputeIds])
                    : undefined,
                  filter.sessionIds
                    ? inArray(cardDisputeSession.sessionId, [...filter.sessionIds])
                    : undefined
                )
              )
              .orderBy(asc(cardDisputeSession.createdAt)),
      allocateSession: (input) =>
        sqlClient
          .withTransaction(
            Effect.gen(function* () {
              const recovery = input.recovery
                ? ((yield* db
                    .insert(helperRecovery)
                    .values(input.recovery)
                    .onConflictDoNothing({ target: helperRecovery.recoveryKey })
                    .returning())[0] ?? null)
                : null;
              const row = (yield* db
                .update(cardDisputeSession)
                .set({
                  allocation: input.allocation,
                  allocationReason: input.reason,
                  helperForfeitCents: input.helperForfeitCents,
                  recoveryId: recovery?.id ?? null,
                  allocatedByUserId: input.actorUserId,
                  allocatedAt: input.at
                })
                .where(
                  and(
                    eq(cardDisputeSession.disputeId, input.disputeId),
                    eq(cardDisputeSession.sessionId, input.sessionId),
                    isNull(cardDisputeSession.allocation)
                  )
                )
                .returning())[0];
              if (!row) return yield* Effect.fail(new TxAbort());
              if (input.ledger.length > 0) {
                yield* db
                  .insert(billingLedgerEntry)
                  .values([...input.ledger])
                  .onConflictDoNothing({ target: billingLedgerEntry.entryKey });
              }
              yield* db.insert(billingAuditEvent).values({ ...input.audit, after: row });
              return row;
            })
          )
          .pipe(Effect.catchTag('TxAbort', () => Effect.succeed(null))),
      recordSubmission: (input, set, audit) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const row = (yield* db
              .insert(cardDisputeEvidenceSubmission)
              .values(input)
              .returning())[0]!;
            yield* db
              .update(cardDispute)
              .set({ ...set, updatedAt: new Date() })
              .where(eq(cardDispute.id, input.disputeId));
            yield* db.insert(billingAuditEvent).values({ ...audit, after: row });
            return row;
          })
        ),
      listSubmissions: (disputeId) =>
        db
          .select()
          .from(cardDisputeEvidenceSubmission)
          .where(eq(cardDisputeEvidenceSubmission.disputeId, disputeId))
          .orderBy(asc(cardDisputeEvidenceSubmission.submittedAt)),
      listChargesForPayment: (paymentId) =>
        db
          .select()
          .from(contractSessionCharge)
          .where(eq(contractSessionCharge.paymentId, paymentId)),
      listExtraSessionAuthorisations: (sessionIds) =>
        sessionIds.length === 0
          ? Effect.succeed([])
          : Effect.gen(function* () {
              // Step 3's table is read by name, guarded, so this step stands
              // on its own branch and needs no change once both are merged.
              const exists = yield* sqlClient<{
                present: boolean;
              }>`select to_regclass('app_db.contract_extra_sessions') is not null as present`;
              if (!exists[0]?.present) return [];
              const rows = yield* sqlClient<{
                session_id: string;
                family_authorised_at: Date | null;
                family_authorised_cents: number | null;
              }>`select session_id, family_authorised_at, family_authorised_cents
                   from app_db.contract_extra_sessions
                  where session_id in ${sqlClient.in([...sessionIds])}`;
              return rows.map((row) => ({
                sessionId: row.session_id,
                authorisedAt: row.family_authorised_at,
                authorisedCents: row.family_authorised_cents
              }));
            })
    };
  })
);

export const CardDisputeRepoDefault = CardDisputeRepoLive.pipe(Layer.provide(DrizzleLive));

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics, for unit tests.

export const makeInMemoryCardDisputeRepo = (
  options: {
    /** The billing repo's state: frozen charges (sessions of a payment) and
     * the ledger (entries are appended there). */
    billing?: { charges: Array<SessionCharge>; ledger: Array<BillingLedgerEntry> };
    /** The money repo's state: recoveries and the audit are appended there. */
    money?: { recoveries: Array<HelperRecovery>; audit: Array<BillingAuditEvent> };
    extraAuthorisations?: ReadonlyArray<ExtraSessionAuthorisation>;
    clock?: () => Date;
  } = {}
) => {
  const now = options.clock ?? (() => new Date());
  const billing = options.billing ?? { charges: [], ledger: [] };
  const money = options.money ?? { recoveries: [], audit: [] };
  const state = {
    disputes: [] as Array<CardDispute>,
    sessions: [] as Array<CardDisputeSession>,
    submissions: [] as Array<CardDisputeEvidenceSubmission>
  };
  const id = () => crypto.randomUUID();

  const patch = (rowId: string, accept: (row: CardDispute) => boolean, set: Patch<CardDispute>) => {
    const index = state.disputes.findIndex((row) => row.id === rowId);
    const row = state.disputes[index];
    if (!row || !accept(row)) return null;
    const next = { ...row, ...set, updatedAt: now() } as CardDispute;
    state.disputes[index] = next;
    return next;
  };

  const audit = (event: BillingAuditInsert, after: unknown) =>
    money.audit.push({
      note: null,
      before: null,
      actorUserId: null,
      ...event,
      after,
      id: id(),
      createdAt: now()
    } as BillingAuditEvent);

  const service: Context.Tag.Service<CardDisputeRepo> = {
    ensure: (input) =>
      Effect.sync(() => {
        const existing = state.disputes.find(
          (row) =>
            row.provider === input.dispute.provider &&
            row.providerReference === input.dispute.providerReference
        );
        if (existing) return { dispute: existing, created: false };
        const dispute = {
          paymentReference: null,
          chargeReference: null,
          contractId: null,
          cycleId: null,
          evidenceDueBy: null,
          chargeRefundable: false,
          hasEvidence: false,
          evidenceSubmissionCount: 0,
          withdrawnCents: 0,
          reinstatedCents: 0,
          feeCents: 0,
          triage: 'needs_response',
          evidenceSummary: null,
          evidenceSummaryByUserId: null,
          evidenceSummaryAt: null,
          closedAt: null,
          noticesSent: [],
          ...input.dispute,
          id: id(),
          createdAt: now(),
          updatedAt: now()
        } as CardDispute;
        state.disputes.push(dispute);
        for (const row of input.sessions) {
          state.sessions.push({
            allocation: null,
            allocationReason: null,
            helperForfeitCents: 0,
            recoveryId: null,
            allocatedByUserId: null,
            allocatedAt: null,
            ...row,
            disputeId: dispute.id,
            createdAt: now()
          } as CardDisputeSession);
        }
        return { dispute, created: true };
      }),
    findById: (rowId) => Effect.sync(() => state.disputes.find((row) => row.id === rowId) ?? null),
    findByProviderReference: (provider, reference) =>
      Effect.sync(
        () =>
          state.disputes.find(
            (row) => row.provider === provider && row.providerReference === reference
          ) ?? null
      ),
    list: (filter) =>
      Effect.sync(() =>
        state.disputes
          .filter(
            (row) =>
              (!filter.triage || filter.triage.includes(row.triage)) &&
              (!filter.familyUserId || row.familyUserId === filter.familyUserId) &&
              (!filter.paymentId || row.paymentId === filter.paymentId) &&
              (filter.open === undefined || (row.closedAt === null) === filter.open)
          )
          .sort((a, b) => b.providerCreatedAt.getTime() - a.providerCreatedAt.getTime())
      ),
    update: (rowId, set) => Effect.sync(() => patch(rowId, () => true, set)),
    advanceTriage: (rowId, input) =>
      Effect.sync(() => patch(rowId, (row) => input.from.includes(row.triage), input.set)),
    appendNotice: (rowId, notice) =>
      Effect.sync(() => {
        const row = state.disputes.find((candidate) => candidate.id === rowId);
        if (!row || row.noticesSent.includes(notice)) return null;
        return patch(rowId, () => true, { noticesSent: [...row.noticesSent, notice] });
      }),
    listSessions: (filter) =>
      Effect.sync(() =>
        state.sessions.filter(
          (row) =>
            (!filter.disputeIds || filter.disputeIds.includes(row.disputeId)) &&
            (!filter.sessionIds || filter.sessionIds.includes(row.sessionId))
        )
      ),
    allocateSession: (input) =>
      Effect.sync(() => {
        const index = state.sessions.findIndex(
          (row) =>
            row.disputeId === input.disputeId &&
            row.sessionId === input.sessionId &&
            row.allocation === null
        );
        if (index < 0) return null;
        let recovery: HelperRecovery | null = null;
        if (input.recovery) {
          recovery =
            money.recoveries.find((row) => row.recoveryKey === input.recovery!.recoveryKey) ??
            null;
          if (!recovery) {
            recovery = {
              resolutionId: null,
              cardDisputeId: null,
              recoveredCents: 0,
              status: 'outstanding',
              ...input.recovery,
              id: id(),
              createdAt: now(),
              updatedAt: now()
            } as HelperRecovery;
            money.recoveries.push(recovery);
          }
        }
        const row = {
          ...state.sessions[index]!,
          allocation: input.allocation,
          allocationReason: input.reason,
          helperForfeitCents: input.helperForfeitCents,
          recoveryId: recovery?.id ?? null,
          allocatedByUserId: input.actorUserId,
          allocatedAt: input.at
        };
        state.sessions[index] = row;
        for (const entry of input.ledger) {
          if (billing.ledger.some((existing) => existing.entryKey === entry.entryKey)) continue;
          billing.ledger.push({
            cycleId: null,
            sessionId: null,
            paymentId: null,
            label: null,
            ...entry,
            id: id(),
            createdAt: now()
          } as BillingLedgerEntry);
        }
        audit(input.audit, row);
        return row;
      }),
    recordSubmission: (input, set, auditInput) =>
      Effect.sync(() => {
        const row = { ...input, id: id(), createdAt: now() } as CardDisputeEvidenceSubmission;
        state.submissions.push(row);
        patch(input.disputeId, () => true, set);
        audit(auditInput, row);
        return row;
      }),
    listSubmissions: (disputeId) =>
      Effect.sync(() => state.submissions.filter((row) => row.disputeId === disputeId)),
    listChargesForPayment: (paymentId) =>
      Effect.sync(() => billing.charges.filter((row) => row.paymentId === paymentId)),
    listExtraSessionAuthorisations: (sessionIds) =>
      Effect.sync(() =>
        (options.extraAuthorisations ?? []).filter((row) => sessionIds.includes(row.sessionId))
      )
  };

  /** The money repo's view of these disputes (what holds pay). */
  const sessionCardDisputes = (): Array<SessionCardDispute> =>
    state.sessions.flatMap((row) => {
      const dispute = state.disputes.find((candidate) => candidate.id === row.disputeId);
      if (!dispute) return [];
      return [
        {
          sessionId: row.sessionId,
          disputeId: row.disputeId,
          status: dispute.status,
          closed: dispute.closedAt !== null,
          allocation: row.allocation ?? null,
          helperForfeitCents: row.helperForfeitCents
        }
      ];
    });

  return { layer: Layer.succeed(CardDisputeRepo, service), state, service, sessionCardDisputes };
};
