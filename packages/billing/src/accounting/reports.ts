import { unpaidExtraSessionStatuses, type AccountingSources } from '@repo/db';
import type { ProviderBalanceTransactionRow } from '@repo/db';
import { isCardDisputeEntryKey, type BorneCardDispute } from './card-dispute-adapter';
import { csv, dollars, monthEnd, monthOf, monthStart } from './books';
import { fundedIncidentRecoveredAt, oneOffPaymentRefunds, type AbsorbedCause } from './obligations';

/**
 * The accountant's reports (Tier 3 step 5, spec §16), each per Toronto
 * month, on screen and as CSV:
 *
 *   - the liabilities snapshot at each month's end — held helper pay,
 *     outstanding recoveries, refunds in flight, unpaid extra sessions;
 *   - refunds issued, with the tax they returned;
 *   - what Poppynz absorbed, by cause;
 *   - the provider's fees, from the imported balance transactions.
 */

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);
const lineTax = (lines: ReadonlyArray<{ taxCents: number }>) =>
  sum(lines.map((line) => line.taxCents));

// ---------------------------------------------------------------------------
// Liabilities at month end

export type LiabilityLine = { count: number; amountCents: number };

export type LiabilitiesRow = {
  month: string;
  /** The instant the snapshot is taken at (month end, or now for the
   * month in progress). */
  asOf: Date;
  heldHelperPay: LiabilityLine;
  outstandingRecoveries: LiabilityLine;
  refundsInFlight: LiabilityLine;
  unpaidExtraSessions: LiabilityLine;
  /** Held pay and repaid recoveries keep no history of when they changed:
   * for a past month those two lines are rebuilt from today's state. */
  approximate: boolean;
};

const line = (amounts: ReadonlyArray<number>): LiabilityLine => ({
  count: amounts.length,
  amountCents: sum(amounts)
});

/** The liabilities at `asOf`, rebuilt from each row's timestamps. */
export const liabilitiesAt = (sources: AccountingSources, asOf: Date) => {
  const shares = new Map(sources.held.map((row) => [row.sessionId, row.helperShareCents ?? 0]));
  const refundsInFlight = sources.refunds.filter((refund) => {
    if (refund.createdAt > asOf) return false;
    if (refund.status === 'succeeded')
      return refund.refundedAt === null || refund.refundedAt > asOf;
    if (refund.status === 'cancelled') return refund.handledAt === null || refund.handledAt > asOf;
    return true;
  });
  const recoveries = sources.recoveries
    .filter((row) => row.createdAt <= asOf)
    .map((row) =>
      row.status === 'outstanding'
        ? row.amountCents - row.recoveredCents
        : row.updatedAt > asOf
          ? row.amountCents
          : 0
    )
    .filter((amount) => amount > 0);
  const unpaid = sources.extraSessions.filter((extra) => {
    const due = extra.chargeAt;
    if (due === null || due > asOf) return false;
    if (unpaidExtraSessionStatuses.includes(extra.status)) return true;
    return extra.status === 'charged' && extra.chargedAt !== null && extra.chargedAt > asOf;
  });
  return {
    heldHelperPay: line(
      sources.held
        .filter((row) => row.appliedAt <= asOf)
        .map((row) => shares.get(row.sessionId) ?? 0)
    ),
    outstandingRecoveries: line(recoveries),
    refundsInFlight: line(refundsInFlight.map((row) => row.totalCents)),
    unpaidExtraSessions: line(unpaid.map((row) => row.familyTotalCents ?? row.quotedTotalCents))
  };
};

export const liabilitiesByMonth = (
  sources: AccountingSources,
  months: ReadonlyArray<string>,
  now: Date
): Array<LiabilitiesRow> =>
  months.map((month) => {
    const end = monthEnd(month);
    const current = end > now;
    const asOf = current ? now : new Date(end.getTime() - 1);
    return { month, asOf, ...liabilitiesAt(sources, asOf), approximate: !current };
  });

export const liabilitiesCsv = (rows: ReadonlyArray<LiabilitiesRow>) =>
  csv(
    [
      'month',
      'as_of',
      'held_helper_pay_count',
      'held_helper_pay_cad',
      'outstanding_recoveries_count',
      'outstanding_recoveries_cad',
      'refunds_in_flight_count',
      'refunds_in_flight_cad',
      'unpaid_extra_sessions_count',
      'unpaid_extra_sessions_cad',
      'total_cad',
      'approximate'
    ],
    rows.map((row) => [
      row.month,
      row.asOf.toISOString(),
      row.heldHelperPay.count,
      dollars(row.heldHelperPay.amountCents),
      row.outstandingRecoveries.count,
      dollars(row.outstandingRecoveries.amountCents),
      row.refundsInFlight.count,
      dollars(row.refundsInFlight.amountCents),
      row.unpaidExtraSessions.count,
      dollars(row.unpaidExtraSessions.amountCents),
      dollars(
        row.heldHelperPay.amountCents +
          row.outstandingRecoveries.amountCents +
          row.refundsInFlight.amountCents +
          row.unpaidExtraSessions.amountCents
      ),
      row.approximate ? 'yes' : 'no'
    ])
  );

// ---------------------------------------------------------------------------
// Refunds issued

export type RefundsRow = {
  month: string;
  count: number;
  /** Of which settled outside the provider ("handled"). */
  handledCount: number;
  refundedCents: number;
  /** Tax given back to families (on the care and the fee). */
  taxReturnedCents: number;
  /** Commission tax Poppynz no longer collects (§13.3). */
  commissionTaxReversedCents: number;
};

/** Refunds made in `months` — a session refund in the month it succeeded
 * (or was marked handled), a one-off refund in the month it was made —
 * the same dating as the tax report. */
export const refundsByMonth = (
  sources: AccountingSources,
  months: ReadonlyArray<string>
): Array<RefundsRow> => {
  const rows = new Map(
    months.map((month) => [
      month,
      {
        month,
        count: 0,
        handledCount: 0,
        refundedCents: 0,
        taxReturnedCents: 0,
        commissionTaxReversedCents: 0
      }
    ])
  );
  for (const refund of sources.refunds) {
    const at =
      refund.status === 'succeeded'
        ? refund.refundedAt
        : refund.status === 'cancelled'
          ? refund.handledAt
          : null;
    if (at === null) continue;
    const row = rows.get(monthOf(at));
    if (!row) continue;
    row.count += 1;
    if (refund.status === 'cancelled') row.handledCount += 1;
    row.refundedCents += refund.totalCents;
    row.taxReturnedCents += lineTax(refund.careTaxLines) + lineTax(refund.feeTaxLines);
    row.commissionTaxReversedCents += lineTax(refund.commissionTaxLines);
  }
  for (const paid of oneOffPaymentRefunds(sources)) {
    if (paid.refundedAt === null) continue;
    const row = rows.get(monthOf(paid.refundedAt));
    if (!row) continue;
    row.count += 1;
    row.refundedCents += paid.capturedCents ?? paid.totalCents;
    row.taxReturnedCents += lineTax(paid.taxLines);
  }
  return [...rows.values()];
};

export const refundsCsv = (rows: ReadonlyArray<RefundsRow>) =>
  csv(
    [
      'month',
      'refunds',
      'handled_outside_provider',
      'refunded_cad',
      'tax_returned_cad',
      'commission_tax_reversed_cad'
    ],
    rows.map((row) => [
      row.month,
      row.count,
      row.handledCount,
      dollars(row.refundedCents),
      dollars(row.taxReturnedCents),
      dollars(row.commissionTaxReversedCents)
    ])
  );

// ---------------------------------------------------------------------------
// Absorbed costs

export type AbsorbedRow = {
  month: string;
  cause: AbsorbedCause;
  count: number;
  amountCents: number;
};

export const absorbedByMonth = (
  sources: AccountingSources,
  disputes: ReadonlyArray<BorneCardDispute>,
  months: ReadonlyArray<string>
): Array<AbsorbedRow> => {
  const wanted = new Set(months);
  const rows = new Map<string, AbsorbedRow>();
  const add = (at: Date, cause: AbsorbedCause, amountCents: number) => {
    const month = monthOf(at);
    if (!wanted.has(month) || amountCents === 0) return;
    const key = `${month}|${cause}`;
    const row = rows.get(key) ?? { month, cause, count: 0, amountCents: 0 };
    row.count += 1;
    row.amountCents += amountCents;
    rows.set(key, row);
  };
  for (const entry of sources.absorbed) {
    if (isCardDisputeEntryKey(entry.entryKey)) continue;
    add(
      entry.createdAt,
      entry.kind === 'platform_absorbed'
        ? 'over_refund'
        : entry.entryKey.endsWith(':resume_absorbed')
          ? 'resume_absorbed'
          : 'carry_write_off',
      entry.amountCents
    );
  }
  for (const dispute of disputes) add(dispute.occurredAt, dispute.cause, dispute.amountCents);
  const cycles = new Map(sources.cycles.map((row) => [row.id, row]));
  for (const incident of sources.fundedIncidents) {
    const cycle = incident.cycleId ? cycles.get(incident.cycleId) : undefined;
    // Recovered from the family after all: not a cost Poppynz bore.
    if (fundedIncidentRecoveredAt(incident, cycle)) continue;
    add(incident.createdAt, 'system_failure', cycle?.providerShareCents ?? 0);
  }
  for (const recovery of sources.recoveries) {
    if (recovery.status !== 'waived') continue;
    add(recovery.updatedAt, 'recovery_waived', recovery.amountCents - recovery.recoveredCents);
  }
  return [...rows.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.cause.localeCompare(b.cause)
  );
};

export const absorbedCsv = (rows: ReadonlyArray<AbsorbedRow>) =>
  csv(
    ['month', 'cause', 'items', 'absorbed_cad'],
    rows.map((row) => [row.month, row.cause, row.count, dollars(row.amountCents)])
  );

// ---------------------------------------------------------------------------
// Provider fees

export type FeesRow = {
  month: string;
  /** Balance transactions imported for the month (0: nothing to report). */
  transactions: number;
  /** Fees taken on charges (processing). */
  processingFeeCents: number;
  /** Fees on disputes. */
  disputeFeeCents: number;
  /** Fees billed on their own (`stripe_fee` and other fee transactions). */
  otherFeeCents: number;
  totalCents: number;
};

const FEE_TYPES = new Set(['stripe_fee', 'application_fee', 'tax_fee', 'stripe_fx_fee']);

/** Whether `[from, to)` lies inside the union of `ranges`. */
const covered = (from: Date, to: Date, ranges: ReadonlyArray<{ from: Date; to: Date }>) => {
  let cursor = from.getTime();
  for (const range of [...ranges].sort((a, b) => a.from.getTime() - b.from.getTime())) {
    if (range.from.getTime() > cursor) break;
    cursor = Math.max(cursor, range.to.getTime());
    if (cursor >= to.getTime()) return true;
  }
  return cursor >= to.getTime();
};

/** The provider's fees per month, from the PLATFORM's imported balance
 * transactions. A month is a gap — its fees may be incomplete — when the
 * successful imports (`coverage`: their periods) don't span all of it (up
 * to `now` for the month in progress); without `coverage`, when it has no
 * imported transaction. */
export const feesByMonth = (
  transactions: ReadonlyArray<ProviderBalanceTransactionRow>,
  months: ReadonlyArray<string>,
  coverage?: { ranges: ReadonlyArray<{ from: Date; to: Date }>; now: Date }
): { rows: Array<FeesRow>; gaps: Array<string> } => {
  const rows = new Map(
    months.map((month) => [
      month,
      {
        month,
        transactions: 0,
        processingFeeCents: 0,
        disputeFeeCents: 0,
        otherFeeCents: 0,
        totalCents: 0
      }
    ])
  );
  for (const txn of transactions) {
    if (txn.account !== null) continue;
    const row = rows.get(monthOf(txn.providerCreatedAt));
    if (!row) continue;
    row.transactions += 1;
    if (FEE_TYPES.has(txn.type) || txn.reportingCategory === 'fee') {
      // A fee of its own is money out (negative amount); its own fee too.
      row.otherFeeCents += -txn.amountCents + txn.feeCents;
    } else if (txn.reportingCategory === 'dispute' || txn.type === 'adjustment') {
      row.disputeFeeCents += txn.feeCents;
    } else {
      row.processingFeeCents += txn.feeCents;
    }
  }
  const list = [...rows.values()].map((row) => ({
    ...row,
    totalCents: row.processingFeeCents + row.disputeFeeCents + row.otherFeeCents
  }));
  const isGap = (row: FeesRow) => {
    if (!coverage) return row.transactions === 0;
    const start = monthStart(row.month);
    if (start >= coverage.now) return false;
    const end = monthEnd(row.month);
    return !covered(start, end < coverage.now ? end : coverage.now, coverage.ranges);
  };
  return { rows: list, gaps: list.filter(isGap).map((row) => row.month) };
};

/** `gaps` (from `feesByMonth`) marks the months not fully imported;
 * without it a month with no transaction is "not recorded". */
export const feesCsv = (rows: ReadonlyArray<FeesRow>, gaps?: ReadonlyArray<string>) =>
  csv(
    [
      'month',
      'transactions',
      'processing_fees_cad',
      'dispute_fees_cad',
      'other_fees_cad',
      'total_fees_cad',
      'recorded'
    ],
    rows.map((row) => [
      row.month,
      row.transactions,
      dollars(row.processingFeeCents),
      dollars(row.disputeFeeCents),
      dollars(row.otherFeeCents),
      dollars(row.totalCents),
      (gaps ? !gaps.includes(row.month) : row.transactions > 0) ? 'yes' : 'no'
    ])
  );
