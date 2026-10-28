import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  conversationMessage,
  sessionResolution,
  sessionResolutionEvent,
  type SessionResolutionActorSide
} from '../schema';
import type { ConversationMessage } from './conversation-repo';

/**
 * Session resolutions (Tier 3, step 1 — spec 2026-10-28 §4.1): what
 * happened to one dated session, and its append-only audit.
 *
 * One ACTIVE resolution per session (a partial unique index; lapsed and
 * reversed rows are history): `record` resolves null when the session
 * already has one, so two clicks or two tabs can't record twice. Every
 * change is a compare-and-set on the status (`advance` resolves null when
 * the row had already moved — the worker's silence step and a late answer
 * may race) and writes its audit row in the same transaction.
 */

export type SessionResolution = InferSelectModel<typeof sessionResolution>;
export type SessionResolutionInsert = Omit<
  InferInsertModel<typeof sessionResolution>,
  'id' | 'createdAt' | 'updatedAt'
>;
export type SessionResolutionKind = SessionResolution['kind'];
export type SessionResolutionStatus = SessionResolution['status'];
export type SessionResolutionSide = SessionResolution['reportedBySide'];
export type SessionResolutionDecision = NonNullable<SessionResolution['decision']>;
export type SessionResolutionEvent = InferSelectModel<typeof sessionResolutionEvent>;
export type { SessionResolutionActorSide };

/** Statuses that hold the session (the partial unique index). */
export const activeResolutionStatuses: ReadonlyArray<SessionResolutionStatus> = [
  'proposed',
  'confirmed',
  'contested',
  'decided'
];

/** Who made a change and why, for the audit row. */
export type ResolutionAudit = {
  actorUserId: string | null;
  actorSide: SessionResolutionActorSide;
  /** recorded, accepted, contested, declined, confirmed_by_silence, lapsed,
   * disputed, decided. */
  action: string;
  note?: string | null;
};

type Patch = Partial<Omit<SessionResolution, 'id' | 'createdAt' | 'updatedAt'>>;

export type ResolutionAdvanceInput = {
  from: ReadonlyArray<SessionResolutionStatus>;
  set: Patch;
};

export class SessionResolutionRepo extends Context.Tag('@repo/db/SessionResolutionRepo')<
  SessionResolutionRepo,
  {
    /** Inserts with its audit row; null when the session already has an
     * active resolution. */
    record: (
      input: SessionResolutionInsert,
      audit: ResolutionAudit
    ) => Effect.Effect<SessionResolution | null, SqlError>;
    findById: (id: string) => Effect.Effect<SessionResolution | null, SqlError>;
    findActiveForSession: (sessionId: string) => Effect.Effect<SessionResolution | null, SqlError>;
    /** Every resolution of a contract (history included), oldest first. */
    listForContract: (contractId: string) => Effect.Effect<Array<SessionResolution>, SqlError>;
    /** The admin queue: resolutions in these statuses, oldest change first. */
    listByStatus: (
      statuses: ReadonlyArray<SessionResolutionStatus>
    ) => Effect.Effect<Array<SessionResolution>, SqlError>;
    /** `proposed` resolutions whose response deadline has passed. */
    listDue: (now: Date) => Effect.Effect<Array<SessionResolution>, SqlError>;
    /** Compare-and-set on the status, with its audit row (before and after)
     * in the same transaction. Null when the row had already moved. */
    advance: (
      id: string,
      input: ResolutionAdvanceInput,
      audit: ResolutionAudit
    ) => Effect.Effect<SessionResolution | null, SqlError>;
    listEvents: (resolutionId: string) => Effect.Effect<Array<SessionResolutionEvent>, SqlError>;
    /** The dispute evidence: a conversation's messages sent in [from, to]. */
    listMessagesBetween: (
      conversationId: string,
      from: Date,
      to: Date
    ) => Effect.Effect<Array<ConversationMessage>, SqlError>;
  }
>() {}

/** A row as the audit stores it (dates as ISO strings). */
const snapshot = (row: SessionResolution) =>
  JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

export const SessionResolutionRepoLive = Layer.effect(
  SessionResolutionRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    return {
      record: (input, audit) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const rows = yield* db
              .insert(sessionResolution)
              .values(input)
              // The partial unique index: one active resolution per session.
              .onConflictDoNothing()
              .returning();
            const row = rows[0];
            if (!row) return null;
            yield* db.insert(sessionResolutionEvent).values({
              resolutionId: row.id,
              actorUserId: audit.actorUserId,
              actorSide: audit.actorSide,
              action: audit.action,
              fromStatus: null,
              toStatus: row.status,
              before: null,
              after: snapshot(row),
              note: audit.note ?? null
            });
            return row;
          })
        ),
      findById: (id) =>
        db
          .select()
          .from(sessionResolution)
          .where(eq(sessionResolution.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findActiveForSession: (sessionId) =>
        db
          .select()
          .from(sessionResolution)
          .where(
            and(
              eq(sessionResolution.sessionId, sessionId),
              inArray(sessionResolution.status, [...activeResolutionStatuses])
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listForContract: (contractId) =>
        db
          .select()
          .from(sessionResolution)
          .where(eq(sessionResolution.contractId, contractId))
          .orderBy(asc(sessionResolution.recordedAt), asc(sessionResolution.id)),
      listByStatus: (statuses) =>
        db
          .select()
          .from(sessionResolution)
          .where(inArray(sessionResolution.status, [...statuses]))
          .orderBy(asc(sessionResolution.updatedAt), asc(sessionResolution.id)),
      listDue: (now) =>
        db
          .select()
          .from(sessionResolution)
          .where(
            and(eq(sessionResolution.status, 'proposed'), lte(sessionResolution.respondBy, now))
          )
          .orderBy(asc(sessionResolution.respondBy)),
      advance: (id, input, audit) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const before = (yield* db
              .select()
              .from(sessionResolution)
              .where(eq(sessionResolution.id, id))
              .for('update'))[0];
            if (!before || !input.from.includes(before.status)) return null;
            const rows = yield* db
              .update(sessionResolution)
              .set({ ...input.set, updatedAt: new Date() })
              .where(
                and(
                  eq(sessionResolution.id, id),
                  inArray(sessionResolution.status, [...input.from])
                )
              )
              .returning();
            const after = rows[0];
            if (!after) return null;
            yield* db.insert(sessionResolutionEvent).values({
              resolutionId: id,
              actorUserId: audit.actorUserId,
              actorSide: audit.actorSide,
              action: audit.action,
              fromStatus: before.status,
              toStatus: after.status,
              before: snapshot(before),
              after: snapshot(after),
              note: audit.note ?? null
            });
            return after;
          })
        ),
      listEvents: (resolutionId) =>
        db
          .select()
          .from(sessionResolutionEvent)
          .where(eq(sessionResolutionEvent.resolutionId, resolutionId))
          .orderBy(asc(sessionResolutionEvent.createdAt), asc(sessionResolutionEvent.id)),
      listMessagesBetween: (conversationId, from, to) =>
        db
          .select()
          .from(conversationMessage)
          .where(
            and(
              eq(conversationMessage.conversationId, conversationId),
              isNull(conversationMessage.deletedAt),
              gte(conversationMessage.createdAt, from),
              lte(conversationMessage.createdAt, to)
            )
          )
          .orderBy(asc(conversationMessage.createdAt))
    };
  })
);

export const SessionResolutionRepoDefault = SessionResolutionRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics, for unit tests.

let memoryId = 0;

export const makeInMemorySessionResolutionRepo = (
  initial: {
    resolutions?: ReadonlyArray<SessionResolution>;
    messages?: ReadonlyArray<ConversationMessage>;
  } = {}
) => {
  const state = {
    resolutions: [...(initial.resolutions ?? [])] as Array<SessionResolution>,
    events: [] as Array<SessionResolutionEvent>,
    messages: [...(initial.messages ?? [])] as Array<ConversationMessage>
  };
  const now = () => new Date();
  const event = (
    row: SessionResolution,
    before: SessionResolution | null,
    audit: ResolutionAudit
  ) => {
    state.events.push({
      id: `resolution-event-${++memoryId}`,
      resolutionId: row.id,
      actorUserId: audit.actorUserId,
      actorSide: audit.actorSide,
      action: audit.action,
      fromStatus: before?.status ?? null,
      toStatus: row.status,
      before: before ? snapshot(before) : null,
      after: snapshot(row),
      note: audit.note ?? null,
      createdAt: now()
    });
  };

  const service: Context.Tag.Service<SessionResolutionRepo> = {
    record: (input, audit) =>
      Effect.sync(() => {
        const taken = state.resolutions.some(
          (row) =>
            row.sessionId === input.sessionId && activeResolutionStatuses.includes(row.status)
        );
        if (taken && activeResolutionStatuses.includes(input.status)) return null;
        const row = dummySessionResolution({
          ...(input as Partial<SessionResolution>),
          id: `resolution-${++memoryId}`,
          createdAt: now(),
          updatedAt: now()
        });
        state.resolutions.push(row);
        event(row, null, audit);
        return row;
      }),
    findById: (id) => Effect.sync(() => state.resolutions.find((row) => row.id === id) ?? null),
    findActiveForSession: (sessionId) =>
      Effect.sync(
        () =>
          state.resolutions.find(
            (row) => row.sessionId === sessionId && activeResolutionStatuses.includes(row.status)
          ) ?? null
      ),
    listForContract: (contractId) =>
      Effect.sync(() =>
        state.resolutions
          .filter((row) => row.contractId === contractId)
          .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
      ),
    listByStatus: (statuses) =>
      Effect.sync(() => state.resolutions.filter((row) => statuses.includes(row.status))),
    listDue: (at) =>
      Effect.sync(() =>
        state.resolutions
          .filter(
            (row) => row.status === 'proposed' && row.respondBy !== null && row.respondBy <= at
          )
          .sort((a, b) => a.respondBy!.getTime() - b.respondBy!.getTime())
      ),
    advance: (id, input, audit) =>
      Effect.sync(() => {
        const index = state.resolutions.findIndex((row) => row.id === id);
        const before = state.resolutions[index];
        if (!before || !input.from.includes(before.status)) return null;
        const after = { ...before, ...input.set, updatedAt: now() } as SessionResolution;
        state.resolutions[index] = after;
        event(after, before, audit);
        return after;
      }),
    listEvents: (resolutionId) =>
      Effect.sync(() => state.events.filter((row) => row.resolutionId === resolutionId)),
    listMessagesBetween: (conversationId, from, to) =>
      Effect.sync(() =>
        state.messages
          .filter(
            (row) =>
              row.conversationId === conversationId &&
              row.deletedAt === null &&
              row.createdAt >= from &&
              row.createdAt <= to
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      )
  };
  return { layer: Layer.succeed(SessionResolutionRepo, service), state, service };
};

/** Unspecified methods behave like empty tables. */
export const makeSessionResolutionRepoTest = (
  implementation: Partial<Context.Tag.Service<SessionResolutionRepo>> = {}
) =>
  Layer.succeed(SessionResolutionRepo, {
    ...makeInMemorySessionResolutionRepo().service,
    ...implementation
  });

export const dummySessionResolution = (
  overrides: Partial<SessionResolution> = {}
): SessionResolution => ({
  id: 'resolution-1',
  contractId: 'contract-1',
  sessionId: 'session-1',
  cycleId: 'cycle-1',
  kind: 'helper_no_show',
  reportedByUserId: 'family-1',
  reportedBySide: 'family',
  recordedAt: new Date('2026-11-03T23:00:00.000Z'),
  reason: null,
  note: null,
  minutesWorked: null,
  status: 'proposed',
  respondBy: null,
  respondedByUserId: null,
  respondedAt: null,
  response: null,
  responseNote: null,
  decidedByUserId: null,
  decidedAt: null,
  decision: null,
  decisionMinutesWorked: null,
  decisionReason: null,
  policyVersionId: null,
  policyVersion: null,
  createdAt: new Date('2026-11-03T23:00:00.000Z'),
  updatedAt: new Date('2026-11-03T23:00:00.000Z'),
  ...overrides
});
