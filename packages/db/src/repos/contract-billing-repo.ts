import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  billingIncident,
  billingLedgerEntry,
  contract,
  contractBilling,
  contractCycle,
  contractSession,
  contractSessionCharge,
  type ContractSessionChargeRoute
} from '../schema';

/**
 * Contract billing state (piece 3): the billing row per accepted contract,
 * its cycles, its dated sessions, the ledger and incidents.
 *
 * Inserts are idempotent on the natural keys (ON CONFLICT DO NOTHING) and
 * every state change is a compare-and-set (`advance…` returns null when the
 * row had already moved), so the worker, the API and a dev clock may all
 * work the same contract at once.
 */

export type ContractBilling = InferSelectModel<typeof contractBilling>;
export type ContractBillingInsert = InferInsertModel<typeof contractBilling>;
export type ContractBillingStatus = ContractBilling['status'];
export type ContractCycle = InferSelectModel<typeof contractCycle>;
export type ContractCycleInsert = Omit<InferInsertModel<typeof contractCycle>, 'id'> & {
  id?: string;
};
export type ContractCycleStatus = ContractCycle['status'];
export type SessionRecord = InferSelectModel<typeof contractSession>;
export type SessionRecordInsert = Omit<InferInsertModel<typeof contractSession>, 'id'>;
export type SessionRecordStatus = SessionRecord['status'];
export type BillingLedgerEntry = InferSelectModel<typeof billingLedgerEntry>;
export type BillingLedgerInsert = Omit<InferInsertModel<typeof billingLedgerEntry>, 'id'>;
export type BillingIncident = InferSelectModel<typeof billingIncident>;
/** The frozen per-session split (Tier 3 step 2). */
export type SessionCharge = InferSelectModel<typeof contractSessionCharge>;
export type SessionChargeInsert = Omit<InferInsertModel<typeof contractSessionCharge>, 'createdAt'>;

type Patch<T> = Partial<Omit<T, 'createdAt' | 'updatedAt'>>;

export type BillingAdvanceInput = {
  from: ReadonlyArray<ContractBillingStatus>;
  set: Patch<ContractBilling>;
};

export type CycleAdvanceInput = {
  from: ReadonlyArray<ContractCycleStatus>;
  /** Also guards the cycle's current attempt when given. */
  paymentId?: string | null;
  /** Also guards the attempt counter when given: two retries started from
   * the same snapshot can't both claim the cycle (and share a key). */
  attempts?: number;
  set: Patch<ContractCycle>;
};

/** Which sessions a bulk status change touches. */
export type SessionFilter = {
  contractId: string;
  cycleId?: string;
  from: ReadonlyArray<SessionRecordStatus>;
  /** Only sessions starting strictly after this instant. */
  startsAfter?: Date;
  /** Only sessions ending at or before this instant. */
  endedBy?: Date;
  /** Only sessions dated strictly after this day. */
  dateAfter?: string;
  /** Only sessions charged this way (Tier 3 step 3: an extra session in its
   * delay or charged on its own payment is never suspended with its cycle). */
  routes?: ReadonlyArray<ContractSessionChargeRoute>;
};

/** Billing rows the tick still has work on. */
export const liveBillingStatuses: ReadonlyArray<ContractBillingStatus> = [
  'awaiting_payment_readiness',
  'scheduled',
  'active',
  'suspended'
];

export class ContractBillingRepo extends Context.Tag('@repo/db/ContractBillingRepo')<
  ContractBillingRepo,
  {
    findBilling: (contractId: string) => Effect.Effect<ContractBilling | null, SqlError>;
    /** Inserts unless one exists; resolves the row on file either way. */
    ensureBilling: (input: ContractBillingInsert) => Effect.Effect<ContractBilling, SqlError>;
    listLiveBilling: () => Effect.Effect<Array<ContractBilling>, SqlError>;
    /** Live billing rows of contracts this user pays for. */
    listLiveBillingForFamily: (userId: string) => Effect.Effect<Array<ContractBilling>, SqlError>;
    advanceBilling: (
      contractId: string,
      input: BillingAdvanceInput
    ) => Effect.Effect<ContractBilling | null, SqlError>;
    /** The family's "Retry payment" rate limit: stamps `family_retry_at =
     * now` unless a retry was claimed after `notBefore`. One atomic
     * compare-and-set, so of two concurrent clicks exactly one wins; null
     * for the loser (or when there is no billing row). */
    claimFamilyRetry: (
      contractId: string,
      now: Date,
      notBefore: Date
    ) => Effect.Effect<ContractBilling | null, SqlError>;
    insertCycles: (rows: ReadonlyArray<ContractCycleInsert>) => Effect.Effect<void, SqlError>;
    listCycles: (contractId: string) => Effect.Effect<Array<ContractCycle>, SqlError>;
    findCycleByPaymentId: (paymentId: string) => Effect.Effect<ContractCycle | null, SqlError>;
    advanceCycle: (
      cycleId: string,
      input: CycleAdvanceInput
    ) => Effect.Effect<ContractCycle | null, SqlError>;
    /** Appends `notice` to the cycle's `notices_sent` in one atomic write,
     * unless it is already there. Resolves the updated cycle, or null when
     * the notice was already recorded (another caller sends it). */
    appendCycleNotice: (
      cycleId: string,
      notice: string
    ) => Effect.Effect<ContractCycle | null, SqlError>;
    insertSessions: (rows: ReadonlyArray<SessionRecordInsert>) => Effect.Effect<void, SqlError>;
    listSessions: (
      contractId: string,
      cycleId?: string
    ) => Effect.Effect<Array<SessionRecord>, SqlError>;
    /** Bulk status change; resolves how many sessions moved. */
    setSessionStatus: (
      filter: SessionFilter,
      status: SessionRecordStatus
    ) => Effect.Effect<number, SqlError>;
    appendLedger: (entries: ReadonlyArray<BillingLedgerInsert>) => Effect.Effect<void, SqlError>;
    listLedger: (contractId: string) => Effect.Effect<Array<BillingLedgerEntry>, SqlError>;
    /** Tier 3 step 2: moves the cycle to captured (compare-and-set) AND
     * writes its frozen per-session split, in one transaction. The split is
     * written only when the move wins; rows on file are kept. Null when the
     * cycle had already moved. */
    captureCycle: (
      cycleId: string,
      input: CycleAdvanceInput,
      charges: ReadonlyArray<SessionChargeInsert>
    ) => Effect.Effect<ContractCycle | null, SqlError>;
    /** The split of an already captured cycle (a backfill): idempotent. */
    insertSessionCharges: (
      charges: ReadonlyArray<SessionChargeInsert>
    ) => Effect.Effect<void, SqlError>;
    listSessionCharges: (
      contractId: string,
      cycleId?: string
    ) => Effect.Effect<Array<SessionCharge>, SqlError>;
    /** One session's money state (Tier 3 step 2): compare-and-set on its
     * status. Null when it had already moved. */
    setSessionMoneyState: (
      sessionId: string,
      input: {
        from: ReadonlyArray<SessionRecordStatus>;
        status: SessionRecordStatus;
        compensationCents: number;
      }
    ) => Effect.Effect<SessionRecord | null, SqlError>;
    /** Once per (cycle, kind); resolves true when this call recorded it. */
    recordIncident: (input: {
      contractId: string;
      cycleId: string | null;
      kind: string;
      detail: string;
    }) => Effect.Effect<boolean, SqlError>;
  }
>() {}

const sessionWhere = (filter: SessionFilter) =>
  and(
    eq(contractSession.contractId, filter.contractId),
    filter.cycleId ? eq(contractSession.cycleId, filter.cycleId) : undefined,
    inArray(contractSession.status, [...filter.from]),
    filter.startsAfter ? gt(contractSession.startsAt, filter.startsAfter) : undefined,
    filter.endedBy ? lte(contractSession.endsAt, filter.endedBy) : undefined,
    filter.dateAfter ? gt(contractSession.date, filter.dateAfter) : undefined,
    filter.routes ? inArray(contractSession.chargeRoute, [...filter.routes]) : undefined
  );

export const ContractBillingRepoLive = Layer.effect(
  ContractBillingRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const findBilling = (contractId: string) =>
      db
        .select()
        .from(contractBilling)
        .where(eq(contractBilling.contractId, contractId))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    const advanceCycleRow = (cycleId: string, input: CycleAdvanceInput) =>
      db
        .update(contractCycle)
        .set({ ...input.set, updatedAt: new Date() })
        .where(
          and(
            eq(contractCycle.id, cycleId),
            inArray(contractCycle.status, [...input.from]),
            input.paymentId === undefined
              ? undefined
              : input.paymentId === null
                ? isNull(contractCycle.paymentId)
                : eq(contractCycle.paymentId, input.paymentId),
            input.attempts === undefined ? undefined : eq(contractCycle.attempts, input.attempts)
          )
        )
        .returning()
        .pipe(Effect.map((rows) => rows[0] ?? null));

    return {
      findBilling,
      ensureBilling: (input) =>
        db
          .insert(contractBilling)
          .values(input)
          .onConflictDoNothing({ target: contractBilling.contractId })
          .pipe(
            Effect.zipRight(findBilling(input.contractId)),
            Effect.map((row) => row!)
          ),
      listLiveBilling: () =>
        db
          .select()
          .from(contractBilling)
          .where(inArray(contractBilling.status, [...liveBillingStatuses]))
          .orderBy(asc(contractBilling.startsOn)),
      listLiveBillingForFamily: (userId) =>
        db
          .select({ billing: contractBilling })
          .from(contractBilling)
          .innerJoin(contract, eq(contract.id, contractBilling.contractId))
          .where(
            and(
              eq(contract.familyUserId, userId),
              inArray(contractBilling.status, [...liveBillingStatuses])
            )
          )
          .pipe(Effect.map((rows) => rows.map((row) => row.billing))),
      advanceBilling: (contractId, input) =>
        db
          .update(contractBilling)
          .set({ ...input.set, updatedAt: new Date() })
          .where(
            and(
              eq(contractBilling.contractId, contractId),
              inArray(contractBilling.status, [...input.from])
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      claimFamilyRetry: (contractId, now, notBefore) =>
        db
          .update(contractBilling)
          .set({ familyRetryAt: now, updatedAt: now })
          .where(
            and(
              eq(contractBilling.contractId, contractId),
              or(
                isNull(contractBilling.familyRetryAt),
                lte(contractBilling.familyRetryAt, notBefore)
              )
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      insertCycles: (rows) =>
        rows.length === 0
          ? Effect.void
          : db
              .insert(contractCycle)
              .values([...rows])
              .onConflictDoNothing({ target: [contractCycle.contractId, contractCycle.index] })
              .pipe(Effect.asVoid),
      listCycles: (contractId) =>
        db
          .select()
          .from(contractCycle)
          .where(eq(contractCycle.contractId, contractId))
          .orderBy(asc(contractCycle.index)),
      findCycleByPaymentId: (paymentId) =>
        db
          .select()
          .from(contractCycle)
          .where(eq(contractCycle.paymentId, paymentId))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      advanceCycle: (cycleId, input) => advanceCycleRow(cycleId, input),
      appendCycleNotice: (cycleId, notice) =>
        db
          .update(contractCycle)
          .set({
            noticesSent: sql`${contractCycle.noticesSent} || ${JSON.stringify([notice])}::jsonb`,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(contractCycle.id, cycleId),
              sql`NOT (${contractCycle.noticesSent} @> ${JSON.stringify([notice])}::jsonb)`
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      insertSessions: (rows) =>
        rows.length === 0
          ? Effect.void
          : db
              .insert(contractSession)
              .values([...rows])
              .onConflictDoNothing({
                target: [contractSession.contractId, contractSession.date, contractSession.slot]
              })
              .pipe(Effect.asVoid),
      listSessions: (contractId, cycleId) =>
        db
          .select()
          .from(contractSession)
          .where(
            and(
              eq(contractSession.contractId, contractId),
              cycleId ? eq(contractSession.cycleId, cycleId) : undefined
            )
          )
          .orderBy(asc(contractSession.startsAt)),
      setSessionStatus: (filter, status) =>
        db
          .update(contractSession)
          .set({ status, updatedAt: new Date() })
          .where(sessionWhere(filter))
          .returning({ id: contractSession.id })
          .pipe(Effect.map((rows) => rows.length)),
      appendLedger: (entries) =>
        entries.length === 0
          ? Effect.void
          : db
              .insert(billingLedgerEntry)
              .values([...entries])
              .onConflictDoNothing({ target: billingLedgerEntry.entryKey })
              .pipe(Effect.asVoid),
      listLedger: (contractId) =>
        db
          .select()
          .from(billingLedgerEntry)
          .where(eq(billingLedgerEntry.contractId, contractId))
          .orderBy(asc(billingLedgerEntry.createdAt)),
      captureCycle: (cycleId, input, charges) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const moved = yield* advanceCycleRow(cycleId, input);
            if (moved && charges.length > 0) {
              yield* db
                .insert(contractSessionCharge)
                .values([...charges])
                .onConflictDoNothing({ target: contractSessionCharge.sessionId });
            }
            return moved;
          })
        ),
      insertSessionCharges: (charges) =>
        charges.length === 0
          ? Effect.void
          : db
              .insert(contractSessionCharge)
              .values([...charges])
              .onConflictDoNothing({ target: contractSessionCharge.sessionId })
              .pipe(Effect.asVoid),
      listSessionCharges: (contractId, cycleId) =>
        db
          .select()
          .from(contractSessionCharge)
          .where(
            and(
              eq(contractSessionCharge.contractId, contractId),
              cycleId ? eq(contractSessionCharge.cycleId, cycleId) : undefined
            )
          ),
      setSessionMoneyState: (sessionId, input) =>
        db
          .update(contractSession)
          .set({
            status: input.status,
            compensationCents: input.compensationCents,
            updatedAt: new Date()
          })
          .where(
            and(eq(contractSession.id, sessionId), inArray(contractSession.status, [...input.from]))
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      recordIncident: (input) =>
        db
          .insert(billingIncident)
          .values(input)
          .onConflictDoNothing({ target: [billingIncident.cycleId, billingIncident.kind] })
          .returning({ id: billingIncident.id })
          .pipe(Effect.map((rows) => rows.length > 0))
    };
  })
);

export const ContractBillingRepoDefault = ContractBillingRepoLive.pipe(Layer.provide(DrizzleLive));

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics, for unit tests.

let memoryId = 0;

export const makeInMemoryContractBillingRepo = (
  initial: {
    billing?: ReadonlyArray<ContractBilling>;
    /** contractId → familyUserId, for listLiveBillingForFamily. */
    families?: Record<string, string>;
  } = {}
) => {
  const state = {
    billing: new Map((initial.billing ?? []).map((row) => [row.contractId, row])),
    cycles: [] as Array<ContractCycle>,
    sessions: [] as Array<SessionRecord>,
    ledger: [] as Array<BillingLedgerEntry>,
    incidents: [] as Array<BillingIncident>,
    charges: [] as Array<SessionCharge>,
    families: { ...(initial.families ?? {}) }
  };
  const now = () => new Date();

  const matches = (row: SessionRecord, filter: SessionFilter) =>
    row.contractId === filter.contractId &&
    (!filter.cycleId || row.cycleId === filter.cycleId) &&
    filter.from.includes(row.status) &&
    (!filter.startsAfter || row.startsAt > filter.startsAfter) &&
    (!filter.endedBy || row.endsAt <= filter.endedBy) &&
    (!filter.dateAfter || row.date > filter.dateAfter) &&
    (!filter.routes || filter.routes.includes(row.chargeRoute));

  const service: Context.Tag.Service<ContractBillingRepo> = {
    findBilling: (contractId) => Effect.sync(() => state.billing.get(contractId) ?? null),
    ensureBilling: (input) =>
      Effect.sync(() => {
        const existing = state.billing.get(input.contractId);
        if (existing) return existing;
        const row = dummyContractBilling(input as Partial<ContractBilling>);
        state.billing.set(row.contractId, row);
        return row;
      }),
    listLiveBilling: () =>
      Effect.sync(() =>
        [...state.billing.values()].filter((row) => liveBillingStatuses.includes(row.status))
      ),
    listLiveBillingForFamily: (userId) =>
      Effect.sync(() =>
        [...state.billing.values()].filter(
          (row) =>
            liveBillingStatuses.includes(row.status) && state.families[row.contractId] === userId
        )
      ),
    advanceBilling: (contractId, input) =>
      Effect.sync(() => {
        const row = state.billing.get(contractId);
        if (!row || !input.from.includes(row.status)) return null;
        const next = { ...row, ...input.set, updatedAt: now() } as ContractBilling;
        state.billing.set(contractId, next);
        return next;
      }),
    claimFamilyRetry: (contractId, at, notBefore) =>
      Effect.sync(() => {
        const row = state.billing.get(contractId);
        if (!row || (row.familyRetryAt !== null && row.familyRetryAt > notBefore)) return null;
        const next = { ...row, familyRetryAt: at, updatedAt: at };
        state.billing.set(contractId, next);
        return next;
      }),
    insertCycles: (rows) =>
      Effect.sync(() => {
        for (const row of rows) {
          if (state.cycles.some((c) => c.contractId === row.contractId && c.index === row.index)) {
            continue;
          }
          state.cycles.push(
            dummyContractCycle({
              ...(row as Partial<ContractCycle>),
              id: row.id ?? `cycle-${++memoryId}`
            })
          );
        }
      }),
    listCycles: (contractId) =>
      Effect.sync(() =>
        state.cycles
          .filter((row) => row.contractId === contractId)
          .sort((a, b) => a.index - b.index)
      ),
    findCycleByPaymentId: (paymentId) =>
      Effect.sync(() => state.cycles.find((row) => row.paymentId === paymentId) ?? null),
    advanceCycle: (cycleId, input) =>
      Effect.sync(() => {
        const index = state.cycles.findIndex((row) => row.id === cycleId);
        const row = state.cycles[index];
        if (!row || !input.from.includes(row.status)) return null;
        if (input.paymentId !== undefined && row.paymentId !== input.paymentId) return null;
        if (input.attempts !== undefined && row.attempts !== input.attempts) return null;
        const next = { ...row, ...input.set, updatedAt: now() } as ContractCycle;
        state.cycles[index] = next;
        return next;
      }),
    appendCycleNotice: (cycleId, notice) =>
      Effect.sync(() => {
        const index = state.cycles.findIndex((row) => row.id === cycleId);
        const row = state.cycles[index];
        if (!row || row.noticesSent.includes(notice)) return null;
        const next = { ...row, noticesSent: [...row.noticesSent, notice], updatedAt: now() };
        state.cycles[index] = next;
        return next;
      }),
    insertSessions: (rows) =>
      Effect.sync(() => {
        for (const row of rows) {
          if (
            state.sessions.some(
              (s) => s.contractId === row.contractId && s.date === row.date && s.slot === row.slot
            )
          ) {
            continue;
          }
          state.sessions.push({
            ...(row as SessionRecord),
            id: `session-${++memoryId}`,
            status: row.status ?? 'scheduled',
            compensationCents: row.compensationCents ?? 0,
            origin: row.origin ?? 'scheduled',
            chargeRoute: row.chargeRoute ?? 'cycle',
            createdAt: now(),
            updatedAt: now()
          });
        }
      }),
    listSessions: (contractId, cycleId) =>
      Effect.sync(() =>
        state.sessions
          .filter((row) => row.contractId === contractId && (!cycleId || row.cycleId === cycleId))
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      ),
    setSessionStatus: (filter, status) =>
      Effect.sync(() => {
        let moved = 0;
        state.sessions = state.sessions.map((row) => {
          if (!matches(row, filter)) return row;
          moved += 1;
          return { ...row, status, updatedAt: now() };
        });
        return moved;
      }),
    appendLedger: (entries) =>
      Effect.sync(() => {
        for (const entry of entries) {
          if (state.ledger.some((row) => row.entryKey === entry.entryKey)) continue;
          state.ledger.push({
            cycleId: null,
            sessionId: null,
            paymentId: null,
            label: null,
            ...entry,
            id: `ledger-${++memoryId}`,
            createdAt: now()
          } as BillingLedgerEntry);
        }
      }),
    listLedger: (contractId) =>
      Effect.sync(() => state.ledger.filter((row) => row.contractId === contractId)),
    captureCycle: (cycleId, input, charges) =>
      Effect.flatMap(service.advanceCycle(cycleId, input), (moved) =>
        moved === null
          ? Effect.succeed(null)
          : Effect.as(service.insertSessionCharges(charges), moved)
      ),
    insertSessionCharges: (charges) =>
      Effect.sync(() => {
        for (const charge of charges) {
          if (state.charges.some((row) => row.sessionId === charge.sessionId)) continue;
          state.charges.push({ ...charge, createdAt: now() } as SessionCharge);
        }
      }),
    listSessionCharges: (contractId, cycleId) =>
      Effect.sync(() =>
        state.charges.filter(
          (row) => row.contractId === contractId && (!cycleId || row.cycleId === cycleId)
        )
      ),
    setSessionMoneyState: (sessionId, input) =>
      Effect.sync(() => {
        const index = state.sessions.findIndex((row) => row.id === sessionId);
        const row = state.sessions[index];
        if (!row || !input.from.includes(row.status)) return null;
        const next = {
          ...row,
          status: input.status,
          compensationCents: input.compensationCents,
          updatedAt: now()
        };
        state.sessions[index] = next;
        return next;
      }),
    recordIncident: (input) =>
      Effect.sync(() => {
        if (
          state.incidents.some((row) => row.cycleId === input.cycleId && row.kind === input.kind)
        ) {
          return false;
        }
        state.incidents.push({
          ...input,
          id: `incident-${++memoryId}`,
          resolvedAt: null,
          createdAt: now()
        });
        return true;
      })
  };
  return { layer: Layer.succeed(ContractBillingRepo, service), state, service };
};

export const dummyContractBilling = (
  overrides: Partial<ContractBilling> = {}
): ContractBilling => ({
  contractId: 'contract-1',
  acceptedVersionId: 'version-1',
  status: 'scheduled',
  suspendedReason: null,
  suspendedAt: null,
  familyFeeBps: 500,
  providerCommissionBps: 1500,
  familyProvince: 'ON',
  helperProvince: 'MB',
  timeZone: 'America/Toronto',
  startsOn: '2026-11-02',
  billableFrom: null,
  materialisedThrough: null,
  remindersSent: [],
  cancelledAt: null,
  endedAt: null,
  lastError: null,
  familyRetryAt: null,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
  ...overrides
});

export const dummyContractCycle = (overrides: Partial<ContractCycle> = {}): ContractCycle => ({
  id: 'cycle-1',
  contractId: 'contract-1',
  index: 0,
  startsOn: '2026-11-02',
  endsOn: '2026-11-04',
  startsAt: new Date('2026-11-02T05:00:00.000Z'),
  endsAt: new Date('2026-11-05T05:00:00.000Z'),
  holdAt: new Date('2026-10-31T04:00:00.000Z'),
  captureAt: new Date('2026-11-02T12:00:00.000Z'),
  transferAt: new Date('2026-11-07T05:00:00.000Z'),
  status: 'scheduled',
  chargeMode: null,
  attempts: 0,
  nextRetryAt: null,
  paymentId: null,
  carriedInCents: 0,
  serviceCents: null,
  serviceTaxCents: null,
  familyFeeBps: null,
  familyFeeCents: null,
  familyFeeTaxCents: null,
  familyTotalCents: null,
  providerCommissionBps: null,
  providerCommissionCents: null,
  providerCommissionTaxCents: null,
  providerShareCents: null,
  taxLines: [],
  compensationCents: 0,
  chargedSessions: [],
  carriedOutCents: 0,
  heldCents: null,
  capturedCents: null,
  fundedAt: null,
  capturedAt: null,
  suspendedAt: null,
  resumeFrom: null,
  noticesSent: [],
  lastError: null,
  createdAt: new Date('2026-10-24T00:00:00.000Z'),
  updatedAt: new Date('2026-10-24T00:00:00.000Z'),
  ...overrides
});

/** Unspecified methods behave like empty tables. */
export const makeContractBillingRepoTest = (
  implementation: Partial<Context.Tag.Service<ContractBillingRepo>> = {}
) =>
  Layer.succeed(ContractBillingRepo, {
    ...makeInMemoryContractBillingRepo().service,
    ...implementation
  });
