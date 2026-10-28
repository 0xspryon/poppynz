import { describe, expect, it } from 'bun:test';
import type { ProviderBalanceTransactionRow } from '@repo/db';
import { monthEnd, monthsBetween } from './books';
import {
  absorbedEntry,
  accountingSources,
  ACCOUNTING_IDS,
  extraSessionRow,
  incidentRow,
  recoveryRow,
  refundRow,
  taxLine
} from './fixtures';
import {
  absorbedByMonth,
  absorbedCsv,
  feesByMonth,
  feesCsv,
  liabilitiesByMonth,
  liabilitiesCsv,
  refundsByMonth,
  refundsCsv
} from './reports';

describe('months in Toronto', () => {
  it('lists months across a year end and ends them at midnight Toronto', () => {
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02'
    ]);
    expect(monthEnd('2026-11').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(monthEnd('2026-12').toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});

describe('the liabilities snapshot', () => {
  const sources = accountingSources({
    refunds: [
      // Made in November, paid back in December: in flight at November's end.
      refundRow({
        id: 'late',
        createdAt: new Date('2026-11-29T00:00:00Z'),
        refundedAt: new Date('2026-12-02T00:00:00Z')
      }),
      refundRow({ id: 'failed', status: 'failed', refundedAt: null, totalCents: 1000 }),
      refundRow({ id: 'done' })
    ],
    recoveries: [recoveryRow({ recoveredCents: 1000 })],
    extraSessions: [
      extraSessionRow(),
      extraSessionRow({
        id: 'charged-later',
        status: 'charged',
        chargedAt: new Date('2026-12-03T00:00:00Z'),
        familyTotalCents: 2000
      })
    ],
    held: [
      {
        sessionId: ACCOUNTING_IDS.session,
        resolutionId: null,
        contractId: ACCOUNTING_IDS.contract,
        cycleId: ACCOUNTING_IDS.cycle,
        outcome: 'held',
        mechanism: 'held',
        familyRefundCents: 0,
        helperOwedCents: 0,
        signature: 'x',
        appliedAt: new Date('2026-11-06T00:00:00Z'),
        updatedAt: new Date('2026-11-06T00:00:00Z'),
        helperShareCents: 5266,
        paymentId: ACCOUNTING_IDS.payment
      }
    ]
  });

  it('rebuilds each month end from the rows’ dates', () => {
    const [november, december] = liabilitiesByMonth(
      sources,
      ['2026-11', '2026-12'],
      new Date('2026-12-15T00:00:00Z')
    );
    expect(november).toMatchObject({
      month: '2026-11',
      heldHelperPay: { count: 1, amountCents: 5266 },
      outstandingRecoveries: { count: 1, amountCents: 3212 },
      refundsInFlight: { count: 2, amountCents: 5041 + 1000 },
      unpaidExtraSessions: { count: 2, amountCents: 5283 + 2000 },
      approximate: true
    });
    expect(november!.asOf.toISOString()).toBe('2026-12-01T04:59:59.999Z');
    // December is in progress: as of now, and exact.
    expect(december).toMatchObject({
      refundsInFlight: { count: 1, amountCents: 1000 },
      unpaidExtraSessions: { count: 1, amountCents: 5283 },
      approximate: false
    });
    const text = liabilitiesCsv([november!]);
    expect(text.split('\n')[1]).toBe(
      '2026-11,2026-12-01T04:59:59.999Z,1,52.66,1,32.12,2,60.41,2,72.83,218.02,yes'
    );
  });
});

describe('refunds issued per month', () => {
  it('dates a refund when it succeeded, a handled one when it was marked, with the tax returned', () => {
    const rows = refundsByMonth(
      accountingSources({
        refunds: [
          refundRow({ careTaxLines: [taxLine('care', 4688, 0)] }),
          refundRow({
            id: 'h',
            status: 'cancelled',
            refundedAt: null,
            resolvedByUserId: ACCOUNTING_IDS.accountant,
            handledAt: new Date('2026-12-10T12:00:00Z')
          }),
          refundRow({ id: 'p', status: 'pending', refundedAt: null })
        ],
        paymentRefunds: [
          {
            id: 'one-off',
            userId: ACCOUNTING_IDS.family,
            kind: 'credibled_order',
            provider: 'stripe',
            providerReference: 'pi_9',
            refundReference: 're_9',
            status: 'refunded',
            totalCents: 6215,
            capturedCents: 6215,
            taxCents: 715,
            taxLines: [taxLine('credibled_check', 5500, 715)],
            capturedAt: new Date('2026-11-01T00:00:00Z'),
            refundedAt: new Date('2026-11-02T00:00:00Z')
          }
        ]
      }),
      ['2026-11', '2026-12']
    );
    expect(rows).toEqual([
      {
        month: '2026-11',
        count: 2,
        handledCount: 0,
        refundedCents: 5041 + 6215,
        taxReturnedCents: 41 + 715,
        commissionTaxReversedCents: 122
      },
      {
        month: '2026-12',
        count: 1,
        handledCount: 1,
        refundedCents: 5041,
        taxReturnedCents: 41,
        commissionTaxReversedCents: 122
      }
    ]);
    expect(refundsCsv(rows).split('\n')[2]).toBe('2026-12,1,1,50.41,0.41,1.22');
  });
});

describe('absorbed costs per month', () => {
  it('groups by cause: write-offs, over-refunds, system failures, waived recoveries, disputes', () => {
    const rows = absorbedByMonth(
      accountingSources({
        absorbed: [
          absorbedEntry(),
          absorbedEntry({ id: 'b', amountCents: 13 }),
          absorbedEntry({
            id: 'c',
            kind: 'platform_absorbed',
            entryKey: 'absorbed:x',
            amountCents: 500
          })
        ],
        fundedIncidents: [incidentRow()],
        recoveries: [
          recoveryRow({
            status: 'waived',
            recoveredCents: 212,
            updatedAt: new Date('2026-11-20T00:00:00Z')
          })
        ]
      }),
      [
        {
          id: 'd',
          disputeId: 'd',
          providerReference: 'du_1',
          cause: 'card_dispute_fee',
          amountCents: 1500,
          paymentId: null,
          contractId: null,
          cycleId: null,
          sessionId: null,
          familyUserId: null,
          status: 'lost',
          occurredAt: new Date('2026-11-21T00:00:00Z')
        }
      ],
      ['2026-11']
    );
    expect(rows).toEqual([
      { month: '2026-11', cause: 'card_dispute_fee', count: 1, amountCents: 1500 },
      { month: '2026-11', cause: 'carry_write_off', count: 2, amountCents: 50 },
      { month: '2026-11', cause: 'over_refund', count: 1, amountCents: 500 },
      { month: '2026-11', cause: 'recovery_waived', count: 1, amountCents: 4000 },
      { month: '2026-11', cause: 'system_failure', count: 1, amountCents: 10531 }
    ]);
    expect(absorbedCsv(rows).split('\n')[2]).toBe('2026-11,carry_write_off,2,0.50');
  });
});

describe('provider fees per month', () => {
  const txn = (
    overrides: Partial<ProviderBalanceTransactionRow>
  ): ProviderBalanceTransactionRow => ({
    id: crypto.randomUUID(),
    provider: 'stripe',
    reference: `txn_${crypto.randomUUID()}`,
    account: null,
    type: 'charge',
    reportingCategory: 'charge',
    amountCents: 6602,
    feeCents: 274,
    netCents: 6328,
    currency: 'cad',
    status: 'available',
    providerCreatedAt: new Date('2026-11-04T12:00:00Z'),
    availableOn: new Date('2026-11-06T00:00:00Z'),
    description: null,
    sourceReference: null,
    sourceType: null,
    paymentReference: null,
    transferReference: null,
    payoutReference: null,
    feeDetails: [],
    matchStatus: 'matched',
    matchKind: 'payment',
    matchedId: null,
    matchNote: null,
    firstRunId: 'r',
    lastRunId: 'r',
    importedAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  it('adds processing, dispute and stand-alone fees, and reports the months with no data', () => {
    const { rows, gaps } = feesByMonth(
      [
        txn({}),
        txn({
          type: 'adjustment',
          reportingCategory: 'dispute',
          amountCents: -5000,
          feeCents: 1500,
          netCents: -6500
        }),
        txn({
          type: 'stripe_fee',
          reportingCategory: 'fee',
          amountCents: -7,
          feeCents: 1,
          netCents: -8
        }),
        // A helper's account: not Poppynz's fees.
        txn({ account: 'acct_1', type: 'payment', feeCents: 99, netCents: 6503 })
      ],
      ['2026-11', '2026-12']
    );
    expect(rows[0]).toEqual({
      month: '2026-11',
      transactions: 3,
      processingFeeCents: 274,
      disputeFeeCents: 1500,
      otherFeeCents: 8,
      totalCents: 1782
    });
    expect(gaps).toEqual(['2026-12']);
    expect(feesCsv(rows).split('\n')[2]).toBe('2026-12,0,0.00,0.00,0.00,0.00,no');
  });

  it('reports a month as a gap unless the successful imports span all of it', () => {
    const now = new Date('2026-12-15T17:00:00Z');
    const months = ['2026-10', '2026-11', '2026-12'];
    const at = (iso: string) => new Date(iso);
    // October imported only from the 20th; November in two runs that
    // overlap, with no transaction at all; December up to now.
    const { rows, gaps } = feesByMonth([txn({})], months, {
      now,
      ranges: [
        { from: at('2026-10-20T04:00:00Z'), to: at('2026-11-10T05:00:00Z') },
        { from: at('2026-11-09T05:00:00Z'), to: at('2026-12-01T05:00:00Z') },
        { from: at('2026-12-01T05:00:00Z'), to: at('2026-12-14T17:00:00Z') }
      ]
    });
    expect(gaps).toEqual(['2026-10']);
    expect(
      feesCsv(rows, gaps)
        .split('\n')
        .slice(1, 4)
        .map((line) => line.split(',').at(-1))
    ).toEqual(['no', 'yes', 'yes']);
    expect(
      feesByMonth([], ['2026-12'], { now, ranges: [{ from: at('2026-12-02T05:00:00Z'), to: now }] })
        .gaps
    ).toEqual(['2026-12']);
  });

  it('counts neither a cycle payment refunded through its sessions twice nor a recovered system failure', () => {
    const refundedAt = new Date('2026-11-21T05:00:00Z');
    const sources = accountingSources({
      refunds: [refundRow({ totalCents: 13206, refundedAt })],
      paymentRefunds: [
        {
          id: ACCOUNTING_IDS.payment,
          userId: ACCOUNTING_IDS.family,
          kind: 'contract_cycle',
          provider: 'stripe',
          providerReference: 'pi_1',
          refundReference: null,
          status: 'refunded',
          totalCents: 13206,
          capturedCents: 13206,
          taxCents: 0,
          taxLines: [],
          capturedAt: new Date('2026-11-04T05:00:00Z'),
          refundedAt
        }
      ],
      fundedIncidents: [incidentRow()],
      cycles: [
        {
          ...accountingSources().cycles[0]!,
          status: 'captured',
          capturedAt: new Date('2026-11-08T05:00:00Z')
        }
      ]
    });
    const [november] = refundsByMonth(sources, ['2026-11']);
    expect(november).toMatchObject({ count: 1, refundedCents: 13206 });
    expect(absorbedByMonth(sources, [], ['2026-11'])).toEqual([]);
  });
});
