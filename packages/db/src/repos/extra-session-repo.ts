import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  asc,
  eq,
  inArray,
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Data, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  billingLedgerEntry,
  contractExtraSession,
  contractExtraSessionEvent,
  contractSession,
  contractSessionCharge,
  type ContractSessionChargeRoute,
  type ExtraSessionActorSide
} from '../schema';
import type {
  BillingLedgerEntry,
  BillingLedgerInsert,
  SessionCharge,
  SessionChargeInsert,
  SessionRecord,
  SessionRecordInsert,
  SessionRecordStatus
} from './contract-billing-repo';

/**
 * Extra sessions (Tier 3 step 3, spec 2026-10-28 §1 step 3): a session either
 * side of a contract proposes outside the weekly pattern, the other side's
 * answer, and what became of its charge.
 *
 * Every change is a compare-and-set on the status and writes its audit row
 * in the same transaction (`contract_extra_session_events`, append-only).
 * The database refuses an extra session that overlaps an open proposal or a
 * session of the contract that isn't cancelled (`ExtraSessionOverlapError`,
 * from the 0044 trigger), and a second open proposal for the same slot.
 * Agreeing creates the dated session in the same transaction; moving the
 * charge (folded into the cycle, or its own payment) moves the session's
 * `charge_route` with it; a successful own charge writes the session's
 * frozen split and its ledger entries with the status.
 */

export type ExtraSession = InferSelectModel<typeof contractExtraSession>;
export type ExtraSessionInsert = Omit<
  InferInsertModel<typeof contractExtraSession>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type ExtraSessionStatus = ExtraSession['status'];
export type ExtraSessionEvent = InferSelectModel<typeof contractExtraSessionEvent>;
export type { ExtraSessionActorSide };

/** An open proposal or an agreed session: what overlaps are checked against. */
export const openExtraSessionStatuses: ReadonlyArray<ExtraSessionStatus> = ['proposed', 'agreed'];

/** Its own charge is under way or was declined: still to be paid. */
export const unpaidExtraSessionStatuses: ReadonlyArray<ExtraSessionStatus> = [
  'charging',
  'charge_failed'
];

/** Who made a change and why, for the audit row. */
export type ExtraSessionAudit = {
  actorUserId: string | null;
  actorSide: ExtraSessionActorSide;
  /** proposed, withdrawn, declined, lapsed, agreed, cancelled, folded,
   * charge_started, charged, charge_declined, abandoned, … */
  action: string;
  note?: string | null;
};

type Patch = Partial<Omit<ExtraSession, 'id' | 'createdAt' | 'updatedAt'>>;

export type ExtraSessionAdvanceInput = {
  from: ReadonlyArray<ExtraSessionStatus>;
  set: Patch;
};

/** The database refused the extra session: it overlaps an open proposal or
 * a session of the contract (or repeats an open proposal's slot). */
export class ExtraSessionOverlapError extends Data.TaggedError('ExtraSessionOverlapError')<{}> {}

export class ExtraSessionRepo extends Context.Tag('@repo/db/ExtraSessionRepo')<
  ExtraSessionRepo,
  {
    /** Inserts a proposal with its audit row. */
    propose: (
      input: ExtraSessionInsert,
      audit: ExtraSessionAudit
    ) => Effect.Effect<ExtraSession, SqlError | ExtraSessionOverlapError>;
    find: (id: string) => Effect.Effect<ExtraSession | null, SqlError>;
    findByPaymentId: (paymentId: string) => Effect.Effect<ExtraSession | null, SqlError>;
    /** Every extra session of a contract (history included), oldest first. */
    listForContract: (contractId: string) => Effect.Effect<Array<ExtraSession>, SqlError>;
    listByStatus: (
      statuses: ReadonlyArray<ExtraSessionStatus>
    ) => Effect.Effect<Array<ExtraSession>, SqlError>;
    /** Compare-and-set on the status, with its audit row. Null when the row
     * had already moved. */
    advance: (
      id: string,
      input: ExtraSessionAdvanceInput,
      audit: ExtraSessionAudit
    ) => Effect.Effect<ExtraSession | null, SqlError | ExtraSessionOverlapError>;
    /** Both sides agreed: the dated session (origin `extra`, charge route
     * `pending`) is created and the row moved to `agreed`, in one
     * transaction. Null when the row had already moved. */
    agree: (
      id: string,
      input: ExtraSessionAdvanceInput & {
        session: Omit<SessionRecordInsert, 'origin' | 'chargeRoute'>;
      },
      audit: ExtraSessionAudit
    ) => Effect.Effect<
      { extra: ExtraSession; session: SessionRecord } | null,
      SqlError | ExtraSessionOverlapError
    >;
    /** Moves the row AND its session's charge route (folded into the cycle,
     * or its own payment) in one transaction. */
    route: (
      id: string,
      input: ExtraSessionAdvanceInput & { route: ContractSessionChargeRoute },
      audit: ExtraSessionAudit
    ) => Effect.Effect<ExtraSession | null, SqlError>;
    /** Cancels the row and (unless it moved on) its session, at no cost. */
    cancel: (
      id: string,
      input: ExtraSessionAdvanceInput & { sessionFrom: ReadonlyArray<SessionRecordStatus> },
      audit: ExtraSessionAudit
    ) => Effect.Effect<ExtraSession | null, SqlError>;
    /** Its own charge succeeded: the row, the session's frozen split and
     * the ledger entries, in one transaction (all idempotent). */
    markCharged: (
      id: string,
      input: ExtraSessionAdvanceInput & {
        charge: SessionChargeInsert;
        ledger: ReadonlyArray<BillingLedgerInsert>;
      },
      audit: ExtraSessionAudit
    ) => Effect.Effect<ExtraSession | null, SqlError>;
    /** Appends a notice once; null when it was already recorded. */
    appendNotice: (id: string, notice: string) => Effect.Effect<ExtraSession | null, SqlError>;
    listEvents: (extraSessionId: string) => Effect.Effect<Array<ExtraSessionEvent>, SqlError>;
  }
>() {}

/** A row as the audit stores it (dates as ISO strings). */
const snapshot = (row: unknown) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

/** SQLSTATE 23P01 (the overlap trigger) or 23505 (the proposal slot index),
 * however deeply the driver nested it. */
export const isExtraSessionOverlap = (error: { cause?: unknown }) => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    const message = String(record.message ?? '');
    if (
      (record.code === '23P01' && message.includes('extra_session_overlap')) ||
      (record.code === '23505' && message.includes('contract_extra_sessions_proposal_slot_uidx'))
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
};

const mapOverlap = <E extends { cause?: unknown }>(error: E): E | ExtraSessionOverlapError =>
  isExtraSessionOverlap(error) ? new ExtraSessionOverlapError() : error;

class TxAbort extends Data.TaggedError('TxAbort')<{}> {}

export const ExtraSessionRepoLive = Layer.effect(
  ExtraSessionRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const find = (id: string) =>
      db
        .select()
        .from(contractExtraSession)
        .where(eq(contractExtraSession.id, id))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    const writeEvent = (
      before: ExtraSession | null,
      after: ExtraSession,
      audit: ExtraSessionAudit
    ) =>
      db.insert(contractExtraSessionEvent).values({
        extraSessionId: after.id,
        actorUserId: audit.actorUserId,
        actorSide: audit.actorSide,
        action: audit.action,
        fromStatus: before?.status ?? null,
        toStatus: after.status,
        before: before ? snapshot(before) : null,
        after: snapshot(after),
        note: audit.note ?? null
      });

    /** The CAS update and its audit row (inside the caller's transaction). */
    const advanceRow = (id: string, input: ExtraSessionAdvanceInput, audit: ExtraSessionAudit) =>
      Effect.gen(function* () {
        const before = yield* find(id);
        if (!before || !input.from.includes(before.status)) return null;
        const rows = yield* db
          .update(contractExtraSession)
          .set({ ...input.set, updatedAt: new Date() })
          .where(
            and(
              eq(contractExtraSession.id, id),
              inArray(contractExtraSession.status, [...input.from])
            )
          )
          .returning();
        const after = rows[0];
        if (!after) return null;
        yield* writeEvent(before, after, audit);
        return after;
      });

    /** Runs `body` in a transaction that is rolled back when it resolves
     * null (the row had moved), so a lost compare-and-set writes nothing. */
    const atomically = <A, E, R>(body: Effect.Effect<A | null, E, R>) =>
      sqlClient
        .withTransaction(
          body.pipe(
            Effect.flatMap((result) =>
              result === null ? Effect.fail(new TxAbort()) : Effect.succeed(result)
            )
          )
        )
        .pipe(Effect.catchTag('TxAbort', () => Effect.succeed(null)));

    return {
      propose: (input, audit) =>
        sqlClient
          .withTransaction(
            Effect.gen(function* () {
              const [row] = yield* db.insert(contractExtraSession).values(input).returning();
              yield* writeEvent(null, row!, audit);
              return row!;
            })
          )
          .pipe(Effect.mapError(mapOverlap)),
      find,
      findByPaymentId: (paymentId) =>
        db
          .select()
          .from(contractExtraSession)
          .where(eq(contractExtraSession.paymentId, paymentId))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listForContract: (contractId) =>
        db
          .select()
          .from(contractExtraSession)
          .where(eq(contractExtraSession.contractId, contractId))
          .orderBy(asc(contractExtraSession.createdAt)),
      listByStatus: (statuses) =>
        db
          .select()
          .from(contractExtraSession)
          .where(inArray(contractExtraSession.status, [...statuses]))
          .orderBy(asc(contractExtraSession.updatedAt)),
      advance: (id, input, audit) =>
        atomically(advanceRow(id, input, audit)).pipe(Effect.mapError(mapOverlap)),
      agree: (id, input, audit) =>
        atomically(
          Effect.gen(function* () {
            const current = yield* find(id);
            if (!current || !input.from.includes(current.status)) return null;
            const [session] = yield* db
              .insert(contractSession)
              .values({ ...input.session, origin: 'extra', chargeRoute: 'pending' })
              .returning();
            const extra = yield* advanceRow(
              id,
              { from: input.from, set: { ...input.set, sessionId: session!.id } },
              audit
            );
            return extra ? { extra, session: session! } : null;
          })
        ).pipe(Effect.mapError(mapOverlap)),
      route: (id, input, audit) =>
        atomically(
          Effect.gen(function* () {
            const extra = yield* advanceRow(id, input, audit);
            if (!extra || extra.sessionId === null) return extra;
            yield* db
              .update(contractSession)
              .set({ chargeRoute: input.route, updatedAt: new Date() })
              .where(eq(contractSession.id, extra.sessionId));
            return extra;
          })
        ),
      cancel: (id, input, audit) =>
        atomically(
          Effect.gen(function* () {
            const extra = yield* advanceRow(id, input, audit);
            if (!extra || extra.sessionId === null) return extra;
            yield* db
              .update(contractSession)
              .set({ status: 'cancelled', updatedAt: new Date() })
              .where(
                and(
                  eq(contractSession.id, extra.sessionId),
                  inArray(contractSession.status, [...input.sessionFrom])
                )
              );
            return extra;
          })
        ),
      markCharged: (id, input, audit) =>
        atomically(
          Effect.gen(function* () {
            const extra = yield* advanceRow(id, input, audit);
            if (!extra) return null;
            yield* db
              .insert(contractSessionCharge)
              .values(input.charge)
              .onConflictDoNothing({ target: contractSessionCharge.sessionId });
            if (input.ledger.length > 0) {
              yield* db
                .insert(billingLedgerEntry)
                .values([...input.ledger])
                .onConflictDoNothing({ target: billingLedgerEntry.entryKey });
            }
            return extra;
          })
        ),
      appendNotice: (id, notice) =>
        db
          .update(contractExtraSession)
          .set({
            noticesSent: sql`${contractExtraSession.noticesSent} || ${JSON.stringify([notice])}::jsonb`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(contractExtraSession.id, id),
              sql`NOT (${contractExtraSession.noticesSent} @> ${JSON.stringify([notice])}::jsonb)`
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listEvents: (extraSessionId) =>
        db
          .select()
          .from(contractExtraSessionEvent)
          .where(eq(contractExtraSessionEvent.extraSessionId, extraSessionId))
          .orderBy(asc(contractExtraSessionEvent.createdAt))
    };
  })
);

export const ExtraSessionRepoDefault = ExtraSessionRepoLive.pipe(Layer.provide(DrizzleLive));

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics (the overlap trigger
// included), for unit tests. Shares the contract-billing repo's state, so
// agreeing creates a session the engine sees.

let memoryId = 0;

type OverlapProbe = Pick<
  ExtraSession,
  'id' | 'contractId' | 'startsAt' | 'endsAt' | 'sessionId' | 'date' | 'startMinutes' | 'status'
>;

export const makeInMemoryExtraSessionRepo = (
  options: {
    billing?: {
      sessions: Array<SessionRecord>;
      charges: Array<SessionCharge>;
      ledger: Array<BillingLedgerEntry>;
    };
    extras?: ReadonlyArray<ExtraSession>;
    clock?: () => Date;
  } = {}
) => {
  const now = options.clock ?? (() => new Date());
  const billing = options.billing ?? { sessions: [], charges: [], ledger: [] };
  const state = {
    extras: [...(options.extras ?? [])] as Array<ExtraSession>,
    events: [] as Array<ExtraSessionEvent>
  };

  const overlaps = (row: OverlapProbe) =>
    state.extras.some(
      (other) =>
        other.contractId === row.contractId &&
        other.id !== row.id &&
        other.status === 'proposed' &&
        ((other.startsAt < row.endsAt && row.startsAt < other.endsAt) ||
          (row.status === 'proposed' &&
            other.date === row.date &&
            other.startMinutes === row.startMinutes))
    ) ||
    billing.sessions.some(
      (session) =>
        session.contractId === row.contractId &&
        session.status !== 'cancelled' &&
        session.id !== row.sessionId &&
        session.startsAt < row.endsAt &&
        row.startsAt < session.endsAt
    );

  const event = (before: ExtraSession | null, after: ExtraSession, audit: ExtraSessionAudit) =>
    state.events.push({
      id: `extra-event-${++memoryId}`,
      extraSessionId: after.id,
      actorUserId: audit.actorUserId,
      actorSide: audit.actorSide,
      action: audit.action,
      fromStatus: before?.status ?? null,
      toStatus: after.status,
      before: before ? snapshot(before) : null,
      after: snapshot(after),
      note: audit.note ?? null,
      createdAt: now()
    });

  const advanceRow = (
    id: string,
    input: ExtraSessionAdvanceInput,
    audit: ExtraSessionAudit
  ): ExtraSession | null | 'overlap' => {
    const index = state.extras.findIndex((row) => row.id === id);
    const before = state.extras[index];
    if (!before || !input.from.includes(before.status)) return null;
    const after = { ...before, ...input.set, updatedAt: now() } as ExtraSession;
    if (
      openExtraSessionStatuses.includes(after.status) &&
      (before.status !== after.status ||
        before.startsAt.getTime() !== after.startsAt.getTime() ||
        before.endsAt.getTime() !== after.endsAt.getTime()) &&
      overlaps(after)
    ) {
      return 'overlap';
    }
    state.extras[index] = after;
    event(before, after, audit);
    return after;
  };

  const plain = (result: ExtraSession | null | 'overlap') => (result === 'overlap' ? null : result);

  const service: Context.Tag.Service<ExtraSessionRepo> = {
    propose: (input, audit) =>
      Effect.suspend(() => {
        const row = {
          note: null,
          status: 'proposed',
          respondedByUserId: null,
          respondedAt: null,
          responseNote: null,
          familyAuthorisedAt: null,
          familyAuthorisedCents: null,
          agreedAt: null,
          chargeAt: null,
          cancelledByUserId: null,
          cancelledAt: null,
          sessionId: null,
          cycleId: null,
          paymentId: null,
          chargeAttempts: 0,
          nextRetryAt: null,
          familyTotalCents: null,
          taxLines: [],
          chargedAt: null,
          lastError: null,
          noticesSent: [],
          ...input,
          id: `extra-${++memoryId}`,
          createdAt: now(),
          updatedAt: now()
        } as ExtraSession;
        if (overlaps(row)) return Effect.fail(new ExtraSessionOverlapError());
        state.extras.push(row);
        event(null, row, audit);
        return Effect.succeed(row);
      }),
    find: (id) => Effect.sync(() => state.extras.find((row) => row.id === id) ?? null),
    findByPaymentId: (paymentId) =>
      Effect.sync(() => state.extras.find((row) => row.paymentId === paymentId) ?? null),
    listForContract: (contractId) =>
      Effect.sync(() => state.extras.filter((row) => row.contractId === contractId)),
    listByStatus: (statuses) =>
      Effect.sync(() => state.extras.filter((row) => statuses.includes(row.status))),
    advance: (id, input, audit) =>
      Effect.suspend(() => {
        const result = advanceRow(id, input, audit);
        return result === 'overlap'
          ? Effect.fail(new ExtraSessionOverlapError())
          : Effect.succeed(result);
      }),
    agree: (id, input, audit) =>
      Effect.suspend(() => {
        const current = state.extras.find((row) => row.id === id);
        if (!current || !input.from.includes(current.status)) return Effect.succeed(null);
        const session = {
          ...(input.session as SessionRecord),
          status: input.session.status ?? 'scheduled',
          compensationCents: input.session.compensationCents ?? 0,
          origin: 'extra',
          chargeRoute: 'pending',
          id: `session-extra-${++memoryId}`,
          createdAt: now(),
          updatedAt: now()
        } as SessionRecord;
        // The trigger checks the row against the contract's other sessions
        // (not its own, inserted in the same transaction).
        const result = advanceRow(
          id,
          { from: input.from, set: { ...input.set, sessionId: session.id } },
          audit
        );
        if (result === 'overlap') return Effect.fail(new ExtraSessionOverlapError());
        if (result === null) return Effect.succeed(null);
        billing.sessions.push(session);
        return Effect.succeed({ extra: result, session });
      }),
    route: (id, input, audit) =>
      Effect.sync(() => {
        const extra = plain(advanceRow(id, input, audit));
        if (extra?.sessionId) {
          const index = billing.sessions.findIndex((row) => row.id === extra.sessionId);
          if (index >= 0) {
            billing.sessions[index] = {
              ...billing.sessions[index]!,
              chargeRoute: input.route,
              updatedAt: now()
            };
          }
        }
        return extra;
      }),
    cancel: (id, input, audit) =>
      Effect.sync(() => {
        const extra = plain(advanceRow(id, input, audit));
        if (extra?.sessionId) {
          const index = billing.sessions.findIndex((row) => row.id === extra.sessionId);
          const session = billing.sessions[index];
          if (session && input.sessionFrom.includes(session.status)) {
            billing.sessions[index] = { ...session, status: 'cancelled', updatedAt: now() };
          }
        }
        return extra;
      }),
    markCharged: (id, input, audit) =>
      Effect.sync(() => {
        const extra = plain(advanceRow(id, input, audit));
        if (!extra) return null;
        if (!billing.charges.some((row) => row.sessionId === input.charge.sessionId)) {
          billing.charges.push({ ...input.charge, createdAt: now() } as SessionCharge);
        }
        for (const entry of input.ledger) {
          if (billing.ledger.some((row) => row.entryKey === entry.entryKey)) continue;
          billing.ledger.push({
            cycleId: null,
            sessionId: null,
            paymentId: null,
            label: null,
            ...entry,
            id: `ledger-extra-${++memoryId}`,
            createdAt: now()
          } as BillingLedgerEntry);
        }
        return extra;
      }),
    appendNotice: (id, notice) =>
      Effect.sync(() => {
        const index = state.extras.findIndex((row) => row.id === id);
        const row = state.extras[index];
        if (!row || row.noticesSent.includes(notice)) return null;
        const next = { ...row, noticesSent: [...row.noticesSent, notice], updatedAt: now() };
        state.extras[index] = next;
        return next;
      }),
    listEvents: (extraSessionId) =>
      Effect.sync(() => state.events.filter((row) => row.extraSessionId === extraSessionId))
  };
  return { layer: Layer.succeed(ExtraSessionRepo, service), state, service };
};

/** Unspecified methods behave like empty tables. */
export const makeExtraSessionRepoTest = (
  implementation: Partial<Context.Tag.Service<ExtraSessionRepo>> = {}
) =>
  Layer.succeed(ExtraSessionRepo, {
    ...makeInMemoryExtraSessionRepo().service,
    ...implementation
  });
