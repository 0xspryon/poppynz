import { describe, expect, it } from 'bun:test';
import type { BillingAuditEvent } from '@repo/db';
import {
  absorbedEntry,
  accountingSources,
  ACCOUNTING_IDS,
  extraSessionRow,
  incidentRow,
  manualPayoutRow,
  recoveryRow,
  refundRow,
  transferRow
} from './fixtures';
import {
  buildObligations,
  filterObligations,
  obligationsCsv,
  totalObligations,
  type Obligation
} from './obligations';

const mark = (
  entityId: string,
  action: string,
  at: string,
  note: string | null = null
): BillingAuditEvent => ({
  id: `${entityId}-${action}-${at}`,
  entity: 'obligation',
  entityId,
  action,
  actorUserId: ACCOUNTING_IDS.accountant,
  note,
  before: null,
  after: null,
  createdAt: new Date(at)
});

const one = (items: ReadonlyArray<Obligation>, key: string) => {
  const found = items.find((item) => item.key === key);
  if (!found) throw new Error(`no ${key} in ${items.map((item) => item.key).join(', ')}`);
  return found;
};

describe('the obligations ledger', () => {
  it('lists family refunds in each state, with their trail to session, cycle, payment and Stripe', () => {
    const items = buildObligations(
      accountingSources({
        refunds: [
          refundRow({ id: 'r-ok' }),
          refundRow({
            id: 'r-pending',
            status: 'pending',
            refundedAt: null,
            providerReference: null
          }),
          refundRow({
            id: 'r-failed',
            status: 'failed',
            refundedAt: null,
            failureReason: 'card closed'
          }),
          refundRow({
            id: 'r-handled',
            status: 'cancelled',
            refundedAt: null,
            resolvedByUserId: ACCOUNTING_IDS.accountant,
            resolvedNote: 'Paid by e-Transfer ET-9',
            handledAt: new Date('2026-11-20T12:00:00.000Z')
          })
        ]
      })
    );
    expect(one(items, 'family_refund:r-ok')).toMatchObject({
      direction: 'payable',
      status: 'paid',
      amountCents: 5041,
      outstandingCents: 0,
      sessionId: ACCOUNTING_IDS.session,
      sessionDate: '2026-11-05',
      serviceName: 'Babysitting',
      cycleId: ACCOUNTING_IDS.cycle,
      cycleLabel: '1 (2026-11-05 – 2026-11-07)',
      contractId: ACCOUNTING_IDS.contract,
      paymentId: ACCOUNTING_IDS.payment,
      paymentReference: 'pi_1',
      providerObject: { kind: 'refund', reference: 're_1' },
      familyName: 'Fiona Family',
      helperName: 'Hana Helper',
      audit: [{ entity: 'session_refund', entityId: 'r-ok' }]
    });
    expect(one(items, 'family_refund:r-pending')).toMatchObject({
      status: 'pending',
      outstandingCents: 5041,
      providerObject: null
    });
    expect(one(items, 'family_refund:r-failed')).toMatchObject({
      status: 'failed',
      outstandingCents: 5041,
      detail: 'card closed'
    });
    expect(one(items, 'family_refund:r-handled')).toMatchObject({
      status: 'handled',
      outstandingCents: 0,
      settledAt: new Date('2026-11-20T12:00:00.000Z'),
      detail: 'Paid by e-Transfer ET-9'
    });
  });

  it('lists Poppynz-funded helper pay, absorbed amounts by cause and lost disputes from the adapter', () => {
    const items = buildObligations(
      accountingSources({
        fundedIncidents: [incidentRow()],
        absorbed: [
          absorbedEntry(),
          absorbedEntry({
            id: 'abs-resume',
            entryKey: `cycle:${ACCOUNTING_IDS.cycle}:resume_absorbed`,
            amountCents: 900
          }),
          absorbedEntry({
            id: 'abs-over',
            kind: 'platform_absorbed',
            entryKey: 'absorbed:s:x',
            sessionId: ACCOUNTING_IDS.session,
            amountCents: 1563,
            label: 'refunded above the decided outcome'
          })
        ]
      }),
      [
        {
          id: 'd-1',
          disputeId: 'd-1',
          providerReference: 'du_1',
          cause: 'card_dispute',
          amountCents: 13206,
          paymentId: ACCOUNTING_IDS.payment,
          contractId: ACCOUNTING_IDS.contract,
          cycleId: ACCOUNTING_IDS.cycle,
          sessionId: null,
          familyUserId: ACCOUNTING_IDS.family,
          status: 'lost',
          occurredAt: new Date('2026-12-01T00:00:00.000Z')
        }
      ]
    );
    expect(one(items, `poppynz_helper_pay:${incidentRow().id}`)).toMatchObject({
      direction: 'cost',
      status: 'outstanding',
      amountCents: 10531,
      cause: 'system_failure'
    });
    expect(one(items, `absorbed:${absorbedEntry().id}`)).toMatchObject({
      status: 'absorbed',
      cause: 'carry_write_off',
      amountCents: 37
    });
    expect(one(items, 'absorbed:abs-resume').cause).toBe('resume_absorbed');
    expect(one(items, 'absorbed:abs-over')).toMatchObject({
      cause: 'over_refund',
      sessionDate: '2026-11-05'
    });
    expect(one(items, 'absorbed:card_dispute:d-1')).toMatchObject({
      cause: 'card_dispute',
      amountCents: 13206,
      providerObject: { kind: 'dispute', reference: 'du_1' },
      familyName: 'Fiona Family'
    });
  });

  it('lists manual payouts recorded, approved or rejected, and recoveries outstanding or repaid', () => {
    const items = buildObligations(
      accountingSources({
        transfers: [transferRow()],
        manualPayouts: [
          manualPayoutRow({ id: 'm-recorded' }),
          manualPayoutRow({
            id: 'm-approved',
            status: 'approved',
            decidedByUserId: 'admin-2',
            decidedAt: new Date('2027-01-07T00:00:00.000Z')
          }),
          manualPayoutRow({ id: 'm-rejected', status: 'rejected', decisionNote: 'wrong amount' })
        ],
        recoveries: [
          recoveryRow({ id: 'v-open', recoveredCents: 1000 }),
          recoveryRow({ id: 'v-repaid', status: 'repaid', recoveredCents: 4212 })
        ]
      })
    );
    expect(one(items, 'manual_payout:m-recorded')).toMatchObject({
      direction: 'payable',
      status: 'recorded',
      outstandingCents: 10531,
      cycleId: ACCOUNTING_IDS.cycle,
      helperName: 'Hana Helper',
      detail: 'interac_etransfer ET-42'
    });
    expect(one(items, 'manual_payout:m-approved')).toMatchObject({
      status: 'approved',
      outstandingCents: 0
    });
    expect(one(items, 'manual_payout:m-rejected')).toMatchObject({
      status: 'rejected',
      detail: 'interac_etransfer ET-42 — wrong amount'
    });
    expect(one(items, 'helper_recovery:v-open')).toMatchObject({
      direction: 'receivable',
      status: 'outstanding',
      outstandingCents: 3212,
      detail: '10.00 recovered so far'
    });
    expect(one(items, 'helper_recovery:v-repaid')).toMatchObject({
      status: 'repaid',
      outstandingCents: 0
    });
  });

  it('lists unpaid extra sessions (not charged ones) and held helper pay', () => {
    const items = buildObligations(
      accountingSources({
        extraSessions: [
          extraSessionRow(),
          extraSessionRow({ id: 'x-charged', status: 'charged', chargedAt: new Date() })
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
            appliedAt: new Date('2026-11-06T00:00:00.000Z'),
            updatedAt: new Date('2026-11-06T00:00:00.000Z'),
            helperShareCents: 5266,
            paymentId: ACCOUNTING_IDS.payment
          }
        ]
      })
    );
    expect(items.filter((item) => item.type === 'unpaid_extra_session')).toHaveLength(1);
    expect(one(items, `unpaid_extra_session:${extraSessionRow().id}`)).toMatchObject({
      direction: 'receivable',
      status: 'unpaid',
      amountCents: 5283,
      detail: 'Your card was declined.'
    });
    expect(one(items, `held_helper_pay:${ACCOUNTING_IDS.session}`)).toMatchObject({
      direction: 'payable',
      status: 'held',
      amountCents: 5266,
      helperName: 'Hana Helper'
    });
  });

  it('lays the latest reconciled mark over settled items only, and counts notes', () => {
    const items = buildObligations(
      accountingSources({
        refunds: [
          refundRow({ id: 'r-ok' }),
          refundRow({ id: 'r-failed', status: 'failed', refundedAt: null })
        ],
        marks: [
          mark('family_refund:r-ok', 'note', '2026-11-05T00:00:00Z', 'on the statement'),
          mark('family_refund:r-ok', 'reconciled', '2026-11-06T00:00:00Z', 'Dec statement'),
          mark('family_refund:r-failed', 'reconciled', '2026-11-06T00:00:00Z')
        ]
      })
    );
    expect(one(items, 'family_refund:r-ok')).toMatchObject({
      status: 'reconciled',
      baseStatus: 'paid',
      notes: 1,
      reconciled: { actorName: 'Ada Accountant', note: 'Dec statement' }
    });
    expect(one(items, 'family_refund:r-failed').status).toBe('failed');
    const undone = buildObligations(
      accountingSources({
        refunds: [refundRow({ id: 'r-ok' })],
        marks: [
          mark('family_refund:r-ok', 'reconciled', '2026-11-06T00:00:00Z'),
          mark('family_refund:r-ok', 'unreconciled', '2026-11-07T00:00:00Z')
        ]
      })
    );
    expect(one(undone, 'family_refund:r-ok')).toMatchObject({ status: 'paid', reconciled: null });
  });

  it('filters by type, status, date, party and contract; totals by direction; exports CSV', () => {
    const items = buildObligations(
      accountingSources({
        refunds: [
          refundRow({ id: 'r-ok' }),
          refundRow({
            id: 'r-failed',
            status: 'failed',
            refundedAt: null,
            createdAt: new Date('2026-12-02T12:00:00Z')
          })
        ],
        recoveries: [recoveryRow({ id: 'v-open' })],
        absorbed: [absorbedEntry()]
      })
    );
    expect(filterObligations(items, { types: ['family_refund'] }).map((item) => item.key)).toEqual([
      'family_refund:r-failed',
      'family_refund:r-ok'
    ]);
    expect(filterObligations(items, { statuses: ['failed'] }).map((item) => item.id)).toEqual([
      'r-failed'
    ]);
    expect(
      filterObligations(items, { from: '2026-11-01', to: '2026-11-30' }).map((item) => item.id)
    ).toEqual(['v-open', 'r-ok', absorbedEntry().id]);
    expect(filterObligations(items, { party: 'hana' })).toHaveLength(4);
    expect(filterObligations(items, { party: 'nobody' })).toHaveLength(0);
    expect(filterObligations(items, { contractId: 'other' })).toHaveLength(0);

    const totals = totalObligations(items);
    expect(totals).toMatchObject({
      count: 4,
      payableCents: 10082,
      outstandingPayableCents: 5041,
      receivableCents: 4212,
      outstandingReceivableCents: 4212,
      costCents: 37
    });
    expect(totals.byType.family_refund).toEqual({
      count: 2,
      amountCents: 10082,
      outstandingCents: 5041
    });

    const text = obligationsCsv(filterObligations(items, { types: ['family_refund'] }));
    const lines = text.trim().split('\n');
    expect(lines[0]).toStartWith('key,type,status,direction,amount_cad,outstanding_cad');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('family_refund:r-ok,family_refund,paid,payable,50.41,0.00');
    expect(lines[2]).toContain(',refund,re_1,');
  });

  it('quotes CSV fields that hold commas or quotes', () => {
    const items = buildObligations(
      accountingSources({
        refunds: [
          refundRow({
            id: 'r-q',
            status: 'cancelled',
            refundedAt: null,
            resolvedByUserId: ACCOUNTING_IDS.admin,
            resolvedNote: 'Paid "by hand", cheque 12',
            handledAt: new Date('2026-11-20T00:00:00Z')
          })
        ]
      })
    );
    expect(obligationsCsv(items)).toContain('"Paid ""by hand"", cheque 12"');
  });

  it('does not count a cycle payment refunded through its session refunds a second time', () => {
    const fullyRefunded = {
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
      refundedAt: new Date('2026-11-21T05:00:00Z')
    };
    const items = buildObligations(
      accountingSources({
        refunds: [refundRow({ id: 'r-ok', totalCents: 13206 })],
        paymentRefunds: [
          fullyRefunded,
          { ...fullyRefunded, id: 'check-1', kind: 'credibled_order', refundReference: 're_c' }
        ]
      })
    );
    expect(items.filter((item) => item.type === 'family_refund').map((item) => item.id)).toEqual(
      expect.arrayContaining(['r-ok', 'check-1'])
    );
    expect(items.filter((item) => item.type === 'family_refund')).toHaveLength(2);
    expect(totalObligations(items).payableCents).toBe(13206 * 2);
  });

  it('treats Poppynz-funded helper pay as recovered once the recovery charge captured the cycle', () => {
    const recovered = buildObligations(
      accountingSources({
        fundedIncidents: [incidentRow()],
        cycles: [
          {
            ...accountingSources().cycles[0]!,
            status: 'captured',
            capturedAt: new Date('2026-11-08T05:00:00Z')
          }
        ]
      })
    );
    const pay = one(recovered, 'poppynz_helper_pay:0198b000-0000-7000-8000-000000000b06');
    expect(pay.baseStatus).toBe('recovered');
    expect(pay.outstandingCents).toBe(0);
    expect(pay.settledAt).toEqual(new Date('2026-11-08T05:00:00Z'));
    const failed = buildObligations(
      accountingSources({
        fundedIncidents: [incidentRow()],
        cycles: [{ ...accountingSources().cycles[0]!, status: 'capture_failed' }]
      })
    );
    expect(one(failed, pay.key).baseStatus).toBe('outstanding');
  });
});
