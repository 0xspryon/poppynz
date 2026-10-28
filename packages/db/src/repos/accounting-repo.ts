import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  billingAuditEvent,
  billingIncident,
  billingLedgerEntry,
  contract,
  contractCycle,
  contractExtraSession,
  contractSession,
  contractSessionCharge,
  helperRecovery,
  helperTransfer,
  helperTransferItem,
  manualPayout,
  payment,
  sessionMoneyEffect,
  sessionRefund,
  sessionResolution,
  user,
  type PaymentTaxLine
} from '../schema';
import type { BillingIncident, BillingLedgerEntry } from './contract-billing-repo';
import type { ExtraSession } from './extra-session-repo';
import type {
  BillingAuditEvent,
  BillingAuditInsert,
  HelperRecovery,
  HelperTransfer,
  HelperTransferItem,
  ManualPayout,
  SessionMoneyEffect,
  SessionRefund
} from './session-money-repo';

/**
 * The accountant's read model (Tier 3 step 5, spec 2026-10-28 §1 step 5,
 * §9, §16): every row behind money Poppynz owes or is owed — session
 * refunds, recoveries from helpers, transfers and manual payouts, absorbed
 * amounts (ledger), system failures Poppynz funds (incidents), held helper
 * pay, unpaid extra sessions — with what they point at (session, cycle,
 * contract, payment, people), so the reimbursements ledger and its reports
 * are built in one pure step (`@repo/billing` obligations).
 *
 * Notes and "reconciled" marks are appended to the money audit
 * (`billing_audit_events`, entity `obligation`): append-only, so every mark
 * is its own audit record and the latest one is the item's state.
 */

/** The audit entity of the accountant's notes and reconciled marks. */
export const OBLIGATION_AUDIT_ENTITY = 'obligation';
/** The audit entity of resolutions of unmatched reconciliation items. */
export const RECONCILIATION_AUDIT_ENTITY = 'reconciliation_item';

export type AccountingSession = {
  id: string;
  contractId: string;
  cycleId: string;
  date: string;
  serviceName: string;
  startMinutes: number;
};

export type AccountingCycle = {
  id: string;
  contractId: string;
  index: number;
  startsOn: string;
  endsOn: string;
  paymentId: string | null;
  providerShareCents: number | null;
};

export type AccountingContract = { id: string; familyUserId: string; providerUserId: string };

export type AccountingPayment = {
  id: string;
  userId: string;
  kind: string;
  provider: string;
  providerReference: string | null;
  refundReference: string | null;
  status: string;
  totalCents: number;
  capturedCents: number | null;
  taxCents: number;
  taxLines: ReadonlyArray<PaymentTaxLine>;
  capturedAt: Date | null;
  refundedAt: Date | null;
};

/** A session whose resolution is held (open report or dispute), with the
 * helper's share frozen on its charge. */
export type HeldSessionPay = SessionMoneyEffect & {
  helperShareCents: number | null;
  paymentId: string | null;
};

export type AccountingSources = {
  refunds: ReadonlyArray<SessionRefund>;
  /** One-off payments refunded in full (background checks). */
  paymentRefunds: ReadonlyArray<AccountingPayment>;
  recoveries: ReadonlyArray<HelperRecovery>;
  transfers: ReadonlyArray<HelperTransfer>;
  manualPayouts: ReadonlyArray<ManualPayout>;
  /** `carry_absorbed` and `platform_absorbed` ledger entries. */
  absorbed: ReadonlyArray<BillingLedgerEntry>;
  /** System failures Poppynz funds the helper through (`capture_failed`). */
  fundedIncidents: ReadonlyArray<BillingIncident>;
  held: ReadonlyArray<HeldSessionPay>;
  /** Extra sessions due for their own charge: unpaid now, or charged. */
  extraSessions: ReadonlyArray<ExtraSession>;
  sessions: ReadonlyArray<AccountingSession>;
  cycles: ReadonlyArray<AccountingCycle>;
  contracts: ReadonlyArray<AccountingContract>;
  payments: ReadonlyArray<AccountingPayment>;
  users: ReadonlyArray<{ id: string; name: string; email: string }>;
  /** Notes and reconciled marks (entity `obligation`), oldest first. */
  marks: ReadonlyArray<BillingAuditEvent>;
};

export type AccountingResolution = {
  id: string;
  kind: string;
  status: string;
  decision: string | null;
  recordedAt: Date;
  decidedAt: Date | null;
};

export type AccountingTrail = {
  audit: ReadonlyArray<BillingAuditEvent>;
  ledger: ReadonlyArray<BillingLedgerEntry>;
  transferItems: ReadonlyArray<HelperTransferItem>;
  resolutions: ReadonlyArray<AccountingResolution>;
};

export class AccountingRepo extends Context.Tag('@repo/db/AccountingRepo')<
  AccountingRepo,
  {
    listSources: () => Effect.Effect<AccountingSources, SqlError>;
    /** The audit events of these (entity, id) pairs, the ledger entries and
     * transfer items of the session (or the cycle's ledger) and the
     * session's resolutions. */
    trail: (input: {
      audit: ReadonlyArray<{ entity: string; entityId: string }>;
      sessionId: string | null;
      cycleId: string | null;
    }) => Effect.Effect<AccountingTrail, SqlError>;
    /** Appends a note or a mark to the money audit. */
    appendMark: (event: BillingAuditInsert) => Effect.Effect<BillingAuditEvent, SqlError>;
    /** Every audit event of an entity, oldest first. */
    listMarks: (entity: string) => Effect.Effect<Array<BillingAuditEvent>, SqlError>;
  }
>() {}

const unique = <A>(values: ReadonlyArray<A | null | undefined>) => [
  ...new Set(values.filter((value): value is A => value !== null && value !== undefined))
];

export const AccountingRepoLive = Layer.effect(
  AccountingRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const paymentColumns = {
      id: payment.id,
      userId: payment.userId,
      kind: payment.kind,
      provider: payment.provider,
      providerReference: payment.providerReference,
      refundReference: payment.refundReference,
      status: payment.status,
      totalCents: payment.totalCents,
      capturedCents: payment.capturedCents,
      taxCents: payment.taxCents,
      taxLines: payment.taxLines,
      capturedAt: payment.capturedAt,
      refundedAt: payment.refundedAt
    };

    const listMarks = (entity: string) =>
      db
        .select()
        .from(billingAuditEvent)
        .where(eq(billingAuditEvent.entity, entity))
        .orderBy(asc(billingAuditEvent.createdAt), asc(billingAuditEvent.id));

    return {
      listSources: () =>
        Effect.gen(function* () {
          const [
            refunds,
            paymentRefunds,
            recoveries,
            transfers,
            manualPayouts,
            absorbed,
            fundedIncidents,
            heldRows,
            extraSessions,
            marks
          ] = yield* Effect.all(
            [
              db.select().from(sessionRefund).orderBy(asc(sessionRefund.createdAt)),
              db
                .select(paymentColumns)
                .from(payment)
                .where(and(eq(payment.status, 'refunded'), isNotNull(payment.refundedAt))),
              db.select().from(helperRecovery).orderBy(asc(helperRecovery.createdAt)),
              db.select().from(helperTransfer).orderBy(asc(helperTransfer.createdAt)),
              db.select().from(manualPayout).orderBy(asc(manualPayout.recordedAt)),
              db
                .select()
                .from(billingLedgerEntry)
                .where(inArray(billingLedgerEntry.kind, ['carry_absorbed', 'platform_absorbed'])),
              db.select().from(billingIncident).where(eq(billingIncident.kind, 'capture_failed')),
              db
                .select({
                  effect: sessionMoneyEffect,
                  helperShareCents: contractSessionCharge.helperShareCents,
                  paymentId: contractSessionCharge.paymentId
                })
                .from(sessionMoneyEffect)
                .leftJoin(
                  contractSessionCharge,
                  eq(contractSessionCharge.sessionId, sessionMoneyEffect.sessionId)
                )
                .where(eq(sessionMoneyEffect.mechanism, 'held')),
              db
                .select()
                .from(contractExtraSession)
                .where(
                  inArray(contractExtraSession.status, [
                    'agreed',
                    'charging',
                    'charge_failed',
                    'charged'
                  ])
                ),
              listMarks(OBLIGATION_AUDIT_ENTITY)
            ],
            { concurrency: 'unbounded' }
          );
          const held = heldRows.map((row) => ({
            ...row.effect,
            helperShareCents: row.helperShareCents ?? null,
            paymentId: row.paymentId ?? null
          }));
          const sessionIds = unique([
            ...refunds.map((row) => row.sessionId),
            ...recoveries.map((row) => row.sessionId),
            ...absorbed.map((row) => row.sessionId),
            ...held.map((row) => row.sessionId),
            ...extraSessions.map((row) => row.sessionId)
          ]);
          const cycleIds = unique([
            ...refunds.map((row) => row.cycleId),
            ...transfers.map((row) => row.cycleId),
            ...absorbed.map((row) => row.cycleId),
            ...fundedIncidents.map((row) => row.cycleId),
            ...held.map((row) => row.cycleId),
            ...extraSessions.map((row) => row.cycleId)
          ]);
          const [sessions, cycles] = yield* Effect.all([
            sessionIds.length === 0
              ? Effect.succeed([])
              : db
                  .select({
                    id: contractSession.id,
                    contractId: contractSession.contractId,
                    cycleId: contractSession.cycleId,
                    date: contractSession.date,
                    serviceName: contractSession.serviceName,
                    startMinutes: contractSession.startMinutes
                  })
                  .from(contractSession)
                  .where(inArray(contractSession.id, sessionIds)),
            cycleIds.length === 0
              ? Effect.succeed([])
              : db
                  .select({
                    id: contractCycle.id,
                    contractId: contractCycle.contractId,
                    index: contractCycle.index,
                    startsOn: contractCycle.startsOn,
                    endsOn: contractCycle.endsOn,
                    paymentId: contractCycle.paymentId,
                    providerShareCents: contractCycle.providerShareCents
                  })
                  .from(contractCycle)
                  .where(inArray(contractCycle.id, cycleIds))
          ]);
          const contractIds = unique([
            ...refunds.map((row) => row.contractId),
            ...recoveries.map((row) => row.contractId),
            ...transfers.map((row) => row.contractId),
            ...absorbed.map((row) => row.contractId),
            ...fundedIncidents.map((row) => row.contractId),
            ...held.map((row) => row.contractId),
            ...extraSessions.map((row) => row.contractId)
          ]);
          const contracts =
            contractIds.length === 0
              ? []
              : yield* db
                  .select({
                    id: contract.id,
                    familyUserId: contract.familyUserId,
                    providerUserId: contract.providerUserId
                  })
                  .from(contract)
                  .where(inArray(contract.id, contractIds));
          const paymentIds = unique([
            ...refunds.map((row) => row.paymentId),
            ...absorbed.map((row) => row.paymentId),
            ...held.map((row) => row.paymentId),
            ...extraSessions.map((row) => row.paymentId),
            ...cycles.map((row) => row.paymentId)
          ]);
          const payments =
            paymentIds.length === 0
              ? []
              : yield* db
                  .select(paymentColumns)
                  .from(payment)
                  .where(inArray(payment.id, paymentIds));
          const userIds = unique([
            ...contracts.flatMap((row) => [row.familyUserId, row.providerUserId]),
            ...recoveries.map((row) => row.helperUserId),
            ...transfers.map((row) => row.helperUserId),
            ...manualPayouts.flatMap((row) => [
              row.helperUserId,
              row.recordedByUserId,
              row.decidedByUserId
            ]),
            ...refunds.map((row) => row.resolvedByUserId),
            ...paymentRefunds.map((row) => row.userId),
            ...marks.map((row) => row.actorUserId)
          ]);
          const users =
            userIds.length === 0
              ? []
              : yield* db
                  .select({ id: user.id, name: user.name, email: user.email })
                  .from(user)
                  .where(inArray(user.id, userIds));
          return {
            refunds,
            paymentRefunds,
            recoveries,
            transfers,
            manualPayouts,
            absorbed,
            fundedIncidents,
            held,
            extraSessions,
            sessions,
            cycles,
            contracts,
            payments,
            users,
            marks
          } satisfies AccountingSources;
        }),

      trail: ({ audit, sessionId, cycleId }) =>
        Effect.gen(function* () {
          const auditRows =
            audit.length === 0
              ? []
              : yield* db
                  .select()
                  .from(billingAuditEvent)
                  .where(
                    or(
                      ...audit.map((pair) =>
                        and(
                          eq(billingAuditEvent.entity, pair.entity),
                          eq(billingAuditEvent.entityId, pair.entityId)
                        )
                      )
                    )
                  )
                  .orderBy(asc(billingAuditEvent.createdAt), asc(billingAuditEvent.id));
          const ledger =
            sessionId !== null
              ? yield* db
                  .select()
                  .from(billingLedgerEntry)
                  .where(eq(billingLedgerEntry.sessionId, sessionId))
                  .orderBy(asc(billingLedgerEntry.createdAt))
              : cycleId !== null
                ? yield* db
                    .select()
                    .from(billingLedgerEntry)
                    .where(eq(billingLedgerEntry.cycleId, cycleId))
                    .orderBy(asc(billingLedgerEntry.createdAt))
                : [];
          const transferItems =
            sessionId === null
              ? []
              : yield* db
                  .select()
                  .from(helperTransferItem)
                  .where(eq(helperTransferItem.sessionId, sessionId))
                  .orderBy(asc(helperTransferItem.createdAt));
          const resolutions =
            sessionId === null
              ? []
              : yield* db
                  .select({
                    id: sessionResolution.id,
                    kind: sessionResolution.kind,
                    status: sessionResolution.status,
                    decision: sessionResolution.decision,
                    recordedAt: sessionResolution.recordedAt,
                    decidedAt: sessionResolution.decidedAt
                  })
                  .from(sessionResolution)
                  .where(eq(sessionResolution.sessionId, sessionId))
                  .orderBy(asc(sessionResolution.recordedAt));
          return { audit: auditRows, ledger, transferItems, resolutions };
        }),

      appendMark: (event) =>
        db
          .insert(billingAuditEvent)
          .values(event)
          .returning()
          .pipe(Effect.map((rows) => rows[0]!)),

      listMarks: (entity) => listMarks(entity)
    };
  })
);

export const AccountingRepoDefault = AccountingRepoLive.pipe(Layer.provide(DrizzleLive));

export const emptyAccountingSources = (): AccountingSources => ({
  refunds: [],
  paymentRefunds: [],
  recoveries: [],
  transfers: [],
  manualPayouts: [],
  absorbed: [],
  fundedIncidents: [],
  held: [],
  extraSessions: [],
  sessions: [],
  cycles: [],
  contracts: [],
  payments: [],
  users: [],
  marks: []
});

/** In-memory stand-in: the given sources; marks are appended to a list the
 * test can read (and that `listSources` and `listMarks` return). */
export const makeInMemoryAccountingRepo = (
  sources: Partial<AccountingSources> = {},
  trail: Partial<AccountingTrail> = {}
) => {
  const marks: Array<BillingAuditEvent> = [...(sources.marks ?? [])];
  let sequence = 0;
  const layer = Layer.succeed(AccountingRepo, {
    listSources: () =>
      Effect.sync(() => ({
        ...emptyAccountingSources(),
        ...sources,
        marks: marks.filter((row) => row.entity === OBLIGATION_AUDIT_ENTITY)
      })),
    trail: ({ audit }) =>
      Effect.sync(() => ({
        audit: [
          ...(trail.audit ?? []),
          ...marks.filter((row) =>
            audit.some((pair) => pair.entity === row.entity && pair.entityId === row.entityId)
          )
        ],
        ledger: trail.ledger ?? [],
        transferItems: trail.transferItems ?? [],
        resolutions: trail.resolutions ?? []
      })),
    appendMark: (event) =>
      Effect.sync(() => {
        sequence += 1;
        const row: BillingAuditEvent = {
          id: `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
          note: null,
          before: null,
          after: null,
          actorUserId: null,
          createdAt: new Date(Date.UTC(2026, 9, 28, 12, 0, sequence)),
          ...event
        };
        marks.push(row);
        return row;
      }),
    listMarks: (entity) => Effect.sync(() => marks.filter((row) => row.entity === entity))
  });
  return { layer, marks };
};
