import {
  unpaidExtraSessionStatuses,
  type AccountingSources,
  type BillingAuditEvent
} from '@repo/db';
import { isCardDisputeEntryKey, type BorneCardDispute } from './card-dispute-adapter';
import { dateIn } from '@repo/calendar';
import { csv, dollars } from './books';

/**
 * The reimbursements and obligations ledger (Tier 3 step 5, spec 2026-10-28
 * §1 step 5, §9, §16): ONE list of the money Poppynz owes or is owed, built
 * from the rows that hold it — never stored, so it can never drift from
 * them. Each item points at its session, cycle, contract, payment and
 * provider object; its status follows the row's lifecycle, and the
 * accountant's "reconciled" mark (an audit event) is laid over a settled
 * one.
 *
 *   | type                  | rows                                  | direction  |
 *   | family_refund         | session refunds, one-off refunds      | payable    |
 *   | poppynz_helper_pay    | `capture_failed` incidents            | cost       |
 *   | absorbed              | carry/over-refund ledger, disputes    | cost       |
 *   | manual_payout         | manual payouts                        | payable    |
 *   | helper_recovery       | recoveries from helpers               | receivable |
 *   | unpaid_extra_session  | extra sessions charging or declined   | receivable |
 *   | held_helper_pay       | sessions held by a report or dispute  | payable    |
 */

export const obligationTypes = [
  'family_refund',
  'poppynz_helper_pay',
  'absorbed',
  'manual_payout',
  'helper_recovery',
  'unpaid_extra_session',
  'held_helper_pay'
] as const;
export type ObligationType = (typeof obligationTypes)[number];

/** Payable: Poppynz owes it. Receivable: owed to Poppynz. Cost: Poppynz
 * bears it. */
export type ObligationDirection = 'payable' | 'receivable' | 'cost';

export const obligationStatuses = [
  'pending',
  'failed',
  'paid',
  'handled',
  'outstanding',
  'recovered',
  'absorbed',
  'recorded',
  'approved',
  'rejected',
  'repaid',
  'waived',
  'unpaid',
  'held',
  'reconciled'
] as const;
export type ObligationStatus = (typeof obligationStatuses)[number];

/** Statuses the accountant may mark reconciled: the money has moved (or
 * was settled for good) and can be matched to a statement. */
export const settledStatuses: ReadonlyArray<ObligationStatus> = [
  'paid',
  'handled',
  'recovered',
  'absorbed',
  'approved',
  'repaid',
  'waived'
];

export type AbsorbedCause =
  | 'carry_write_off'
  | 'resume_absorbed'
  | 'over_refund'
  | 'card_dispute'
  | 'card_dispute_fee'
  | 'system_failure'
  | 'recovery_waived';

export type ProviderObject = {
  kind: 'refund' | 'transfer' | 'payment_intent' | 'dispute';
  reference: string;
};

export type ReconciledMark = {
  at: Date;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
};

export type Obligation = {
  /** `<type>:<id>` — stable; the audit entity id of notes and marks. */
  key: string;
  type: ObligationType;
  id: string;
  direction: ObligationDirection;
  /** The row's own lifecycle. */
  baseStatus: Exclude<ObligationStatus, 'reconciled'>;
  /** `reconciled` once marked so, else the base status. */
  status: ObligationStatus;
  reconciled: ReconciledMark | null;
  amountCents: number;
  /** What is still open (owed, unpaid, unrecovered); 0 once settled. */
  outstandingCents: number;
  occurredAt: Date;
  settledAt: Date | null;
  contractId: string | null;
  cycleId: string | null;
  cycleLabel: string | null;
  sessionId: string | null;
  sessionDate: string | null;
  serviceName: string | null;
  paymentId: string | null;
  paymentReference: string | null;
  providerObject: ProviderObject | null;
  familyUserId: string | null;
  familyName: string | null;
  helperUserId: string | null;
  helperName: string | null;
  cause: AbsorbedCause | null;
  detail: string | null;
  /** The money audit's (entity, id) pairs of the row behind it. */
  audit: ReadonlyArray<{ entity: string; entityId: string }>;
  notes: number;
};

const keyOf = (type: ObligationType, id: string) => `${type}:${id}`;

/** The latest reconciled/unreconciled mark per key, and the note counts. */
const marksByKey = (marks: ReadonlyArray<BillingAuditEvent>, names: Map<string, string>) => {
  const reconciled = new Map<string, ReconciledMark | null>();
  const notes = new Map<string, number>();
  for (const mark of marks) {
    if (mark.action === 'note') notes.set(mark.entityId, (notes.get(mark.entityId) ?? 0) + 1);
    if (mark.action === 'reconciled') {
      reconciled.set(mark.entityId, {
        at: mark.createdAt,
        actorUserId: mark.actorUserId,
        actorName: mark.actorUserId ? (names.get(mark.actorUserId) ?? null) : null,
        note: mark.note
      });
    }
    if (mark.action === 'unreconciled') reconciled.set(mark.entityId, null);
  }
  return { reconciled, notes };
};

const absorbedCauseOf = (entryKey: string, kind: string): AbsorbedCause =>
  kind === 'platform_absorbed'
    ? 'over_refund'
    : entryKey.endsWith(':resume_absorbed')
      ? 'resume_absorbed'
      : 'carry_write_off';

/** Every obligation, newest first. */
export const buildObligations = (
  sources: AccountingSources,
  disputes: ReadonlyArray<BorneCardDispute> = []
): Array<Obligation> => {
  const names = new Map(sources.users.map((row) => [row.id, row.name]));
  const contracts = new Map(sources.contracts.map((row) => [row.id, row]));
  const sessions = new Map(sources.sessions.map((row) => [row.id, row]));
  const cycles = new Map(sources.cycles.map((row) => [row.id, row]));
  const payments = new Map(sources.payments.map((row) => [row.id, row]));
  const transfers = new Map(sources.transfers.map((row) => [row.id, row]));
  const { reconciled, notes } = marksByKey(sources.marks, names);

  const context = (ids: {
    contractId?: string | null;
    cycleId?: string | null;
    sessionId?: string | null;
    paymentId?: string | null;
    helperUserId?: string | null;
    familyUserId?: string | null;
  }) => {
    const session = ids.sessionId ? sessions.get(ids.sessionId) : undefined;
    const cycleId = ids.cycleId ?? session?.cycleId ?? null;
    const cycle = cycleId ? cycles.get(cycleId) : undefined;
    const contractId = ids.contractId ?? session?.contractId ?? cycle?.contractId ?? null;
    const contract = contractId ? contracts.get(contractId) : undefined;
    const paymentId = ids.paymentId ?? cycle?.paymentId ?? null;
    const familyUserId = ids.familyUserId ?? contract?.familyUserId ?? null;
    const helperUserId = ids.helperUserId ?? contract?.providerUserId ?? null;
    return {
      contractId,
      cycleId,
      cycleLabel: cycle ? `${cycle.index + 1} (${cycle.startsOn} – ${cycle.endsOn})` : null,
      sessionId: ids.sessionId ?? null,
      sessionDate: session?.date ?? null,
      serviceName: session?.serviceName ?? null,
      paymentId,
      paymentReference: paymentId ? (payments.get(paymentId)?.providerReference ?? null) : null,
      familyUserId,
      familyName: familyUserId ? (names.get(familyUserId) ?? null) : null,
      helperUserId,
      helperName: helperUserId ? (names.get(helperUserId) ?? null) : null
    };
  };

  const item = (
    type: ObligationType,
    id: string,
    fields: Omit<
      Obligation,
      'key' | 'type' | 'id' | 'status' | 'reconciled' | 'notes' | keyof ReturnType<typeof context>
    > &
      ReturnType<typeof context>
  ): Obligation => {
    const key = keyOf(type, id);
    const mark = settledStatuses.includes(fields.baseStatus) ? (reconciled.get(key) ?? null) : null;
    return {
      key,
      type,
      id,
      ...fields,
      status: mark ? 'reconciled' : fields.baseStatus,
      reconciled: mark,
      notes: notes.get(key) ?? 0
    };
  };

  const items: Array<Obligation> = [];

  for (const refund of sources.refunds) {
    const baseStatus =
      refund.status === 'succeeded'
        ? 'paid'
        : refund.status === 'failed'
          ? 'failed'
          : refund.status === 'cancelled'
            ? 'handled'
            : 'pending';
    items.push(
      item('family_refund', refund.id, {
        direction: 'payable',
        baseStatus,
        amountCents: refund.totalCents,
        outstandingCents:
          baseStatus === 'pending' || baseStatus === 'failed' ? refund.totalCents : 0,
        occurredAt: refund.createdAt,
        settledAt:
          baseStatus === 'paid'
            ? refund.refundedAt
            : baseStatus === 'handled'
              ? refund.handledAt
              : null,
        providerObject: refund.providerReference
          ? { kind: 'refund', reference: refund.providerReference }
          : null,
        cause: null,
        detail:
          baseStatus === 'handled'
            ? refund.resolvedNote
            : baseStatus === 'failed'
              ? refund.failureReason
              : null,
        audit: [{ entity: 'session_refund', entityId: refund.id }],
        ...context({
          contractId: refund.contractId,
          cycleId: refund.cycleId,
          sessionId: refund.sessionId,
          paymentId: refund.paymentId
        })
      })
    );
  }

  // One-off charges (background checks) refunded in full.
  for (const paid of sources.paymentRefunds) {
    items.push(
      item('family_refund', paid.id, {
        direction: 'payable',
        baseStatus: 'paid',
        amountCents: paid.capturedCents ?? paid.totalCents,
        outstandingCents: 0,
        occurredAt: paid.refundedAt ?? paid.capturedAt ?? new Date(0),
        settledAt: paid.refundedAt,
        providerObject: paid.refundReference
          ? { kind: 'refund', reference: paid.refundReference }
          : null,
        cause: null,
        detail: paid.kind,
        audit: [],
        ...context({ paymentId: paid.id, familyUserId: paid.userId })
      })
    );
  }

  for (const incident of sources.fundedIncidents) {
    const cycle = incident.cycleId ? cycles.get(incident.cycleId) : undefined;
    const amount = cycle?.providerShareCents ?? 0;
    items.push(
      item('poppynz_helper_pay', incident.id, {
        direction: 'cost',
        baseStatus: incident.resolvedAt ? 'recovered' : 'outstanding',
        amountCents: amount,
        outstandingCents: incident.resolvedAt ? 0 : amount,
        occurredAt: incident.createdAt,
        settledAt: incident.resolvedAt,
        providerObject: null,
        cause: 'system_failure',
        detail: incident.detail,
        audit: [],
        ...context({ contractId: incident.contractId, cycleId: incident.cycleId })
      })
    );
  }

  for (const entry of sources.absorbed) {
    // A dispute allocation's entry: counted through the adapter.
    if (isCardDisputeEntryKey(entry.entryKey)) continue;
    items.push(
      item('absorbed', entry.id, {
        direction: 'cost',
        baseStatus: 'absorbed',
        amountCents: entry.amountCents,
        outstandingCents: 0,
        occurredAt: entry.createdAt,
        settledAt: entry.createdAt,
        providerObject: null,
        cause: absorbedCauseOf(entry.entryKey, entry.kind),
        detail: entry.label,
        audit: [],
        ...context({
          contractId: entry.contractId,
          cycleId: entry.cycleId,
          sessionId: entry.sessionId,
          paymentId: entry.paymentId
        })
      })
    );
  }

  for (const dispute of disputes) {
    items.push(
      item('absorbed', `${dispute.cause}:${dispute.id}`, {
        direction: 'cost',
        baseStatus: 'absorbed',
        amountCents: dispute.amountCents,
        outstandingCents: 0,
        occurredAt: dispute.occurredAt,
        settledAt: dispute.occurredAt,
        providerObject: { kind: 'dispute', reference: dispute.providerReference },
        cause: dispute.cause,
        detail: dispute.status,
        audit: [{ entity: 'card_dispute', entityId: dispute.disputeId }],
        ...context({
          contractId: dispute.contractId,
          cycleId: dispute.cycleId,
          sessionId: dispute.sessionId,
          paymentId: dispute.paymentId,
          familyUserId: dispute.familyUserId
        })
      })
    );
  }

  for (const payout of sources.manualPayouts) {
    const transfer = transfers.get(payout.transferId);
    const baseStatus =
      payout.status === 'approved'
        ? 'approved'
        : payout.status === 'rejected'
          ? 'rejected'
          : 'recorded';
    items.push(
      item('manual_payout', payout.id, {
        direction: 'payable',
        baseStatus,
        amountCents: payout.amountCents,
        outstandingCents: baseStatus === 'recorded' ? payout.amountCents : 0,
        occurredAt: payout.recordedAt,
        settledAt: payout.decidedAt,
        providerObject: null,
        cause: null,
        detail: `${payout.method} ${payout.reference}${payout.decisionNote ? ` — ${payout.decisionNote}` : ''}`,
        audit: [
          { entity: 'manual_payout', entityId: payout.transferId },
          { entity: 'manual_payout', entityId: payout.id }
        ],
        ...context({
          contractId: transfer?.contractId ?? null,
          cycleId: transfer?.cycleId ?? null,
          helperUserId: payout.helperUserId
        })
      })
    );
  }

  for (const recovery of sources.recoveries) {
    const baseStatus = recovery.status;
    items.push(
      item('helper_recovery', recovery.id, {
        direction: 'receivable',
        baseStatus,
        amountCents: recovery.amountCents,
        outstandingCents:
          baseStatus === 'outstanding' ? recovery.amountCents - recovery.recoveredCents : 0,
        occurredAt: recovery.createdAt,
        settledAt: baseStatus === 'outstanding' ? null : recovery.updatedAt,
        providerObject: null,
        cause: null,
        detail:
          recovery.recoveredCents > 0 && baseStatus === 'outstanding'
            ? `${dollars(recovery.recoveredCents)} recovered so far`
            : null,
        audit: [],
        ...context({
          contractId: recovery.contractId,
          sessionId: recovery.sessionId,
          helperUserId: recovery.helperUserId
        })
      })
    );
  }

  for (const extra of sources.extraSessions) {
    if (!unpaidExtraSessionStatuses.includes(extra.status)) continue;
    const amount = extra.familyTotalCents ?? extra.quotedTotalCents;
    items.push(
      item('unpaid_extra_session', extra.id, {
        direction: 'receivable',
        baseStatus: 'unpaid',
        amountCents: amount,
        outstandingCents: amount,
        occurredAt: extra.chargeAt ?? extra.agreedAt ?? extra.createdAt,
        settledAt: null,
        providerObject: null,
        cause: null,
        detail: extra.lastError,
        audit: [],
        ...context({
          contractId: extra.contractId,
          cycleId: extra.cycleId,
          sessionId: extra.sessionId,
          paymentId: extra.paymentId
        })
      })
    );
  }

  for (const held of sources.held) {
    const amount = held.helperShareCents ?? 0;
    items.push(
      item('held_helper_pay', held.sessionId, {
        direction: 'payable',
        baseStatus: 'held',
        amountCents: amount,
        outstandingCents: amount,
        occurredAt: held.appliedAt,
        settledAt: null,
        providerObject: null,
        cause: null,
        detail: held.outcome,
        audit: [],
        ...context({
          contractId: held.contractId,
          cycleId: held.cycleId,
          sessionId: held.sessionId,
          paymentId: held.paymentId
        })
      })
    );
  }

  return items.sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || a.key.localeCompare(b.key)
  );
};

export type ObligationFilter = {
  types?: ReadonlyArray<ObligationType>;
  statuses?: ReadonlyArray<ObligationStatus>;
  /** Toronto dates, inclusive, on `occurredAt`. */
  from?: string;
  to?: string;
  /** A family or helper: their user id, or part of their name. */
  party?: string;
  contractId?: string;
};

export const filterObligations = (
  items: ReadonlyArray<Obligation>,
  filter: ObligationFilter,
  zone = 'America/Toronto'
) => {
  const party = filter.party?.trim().toLowerCase() ?? '';
  return items.filter((item) => {
    if (filter.types?.length && !filter.types.includes(item.type)) return false;
    if (
      filter.statuses?.length &&
      !filter.statuses.includes(item.status) &&
      !filter.statuses.includes(item.baseStatus)
    ) {
      return false;
    }
    const day = dateIn(item.occurredAt, zone);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (filter.contractId && item.contractId !== filter.contractId) return false;
    if (party) {
      const matches = [item.familyUserId, item.helperUserId, item.familyName, item.helperName].some(
        (value) =>
          value !== null && (value.toLowerCase() === party || value.toLowerCase().includes(party))
      );
      if (!matches) return false;
    }
    return true;
  });
};

export type ObligationTotals = {
  count: number;
  /** Sum of amounts by direction. */
  payableCents: number;
  receivableCents: number;
  costCents: number;
  /** Still open, by direction. */
  outstandingPayableCents: number;
  outstandingReceivableCents: number;
  byType: Record<ObligationType, { count: number; amountCents: number; outstandingCents: number }>;
};

export const totalObligations = (items: ReadonlyArray<Obligation>): ObligationTotals => {
  const byType = Object.fromEntries(
    obligationTypes.map((type) => [type, { count: 0, amountCents: 0, outstandingCents: 0 }])
  ) as ObligationTotals['byType'];
  const totals: ObligationTotals = {
    count: items.length,
    payableCents: 0,
    receivableCents: 0,
    costCents: 0,
    outstandingPayableCents: 0,
    outstandingReceivableCents: 0,
    byType
  };
  for (const item of items) {
    byType[item.type].count += 1;
    byType[item.type].amountCents += item.amountCents;
    byType[item.type].outstandingCents += item.outstandingCents;
    if (item.direction === 'payable') {
      totals.payableCents += item.amountCents;
      totals.outstandingPayableCents += item.outstandingCents;
    } else if (item.direction === 'receivable') {
      totals.receivableCents += item.amountCents;
      totals.outstandingReceivableCents += item.outstandingCents;
    } else {
      totals.costCents += item.amountCents;
    }
  }
  return totals;
};

const iso = (at: Date | null) => (at ? at.toISOString() : '');

export const obligationsCsv = (items: ReadonlyArray<Obligation>) =>
  csv(
    [
      'key',
      'type',
      'status',
      'direction',
      'amount_cad',
      'outstanding_cad',
      'occurred_at',
      'settled_at',
      'family',
      'helper',
      'contract_id',
      'cycle_id',
      'session_id',
      'session_date',
      'service',
      'payment_id',
      'payment_reference',
      'provider_object',
      'provider_reference',
      'cause',
      'reconciled_at',
      'reconciled_by',
      'detail'
    ],
    items.map((item) => [
      item.key,
      item.type,
      item.status,
      item.direction,
      dollars(item.amountCents),
      dollars(item.outstandingCents),
      iso(item.occurredAt),
      iso(item.settledAt),
      item.familyName ?? item.familyUserId,
      item.helperName ?? item.helperUserId,
      item.contractId,
      item.cycleId,
      item.sessionId,
      item.sessionDate,
      item.serviceName,
      item.paymentId,
      item.paymentReference,
      item.providerObject?.kind ?? null,
      item.providerObject?.reference ?? null,
      item.cause,
      iso(item.reconciled?.at ?? null),
      item.reconciled?.actorName ?? item.reconciled?.actorUserId ?? null,
      item.detail
    ])
  );
