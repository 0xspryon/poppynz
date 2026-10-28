import { describe, expect, it } from 'bun:test';
import { makeInMemoryCardDisputeRepo, type CardDispute, type CardDisputeSession } from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { Effect, Layer } from 'effect';
import { borneByPoppynz, CardDisputeLedger, CardDisputeLedgerLive } from './card-dispute-adapter';
import { absorbedEntry, accountingSources, ACCOUNTING_IDS } from './fixtures';
import { buildObligations } from './obligations';
import { absorbedByMonth } from './reports';

const dispute = (overrides: Partial<CardDispute> = {}): CardDispute =>
  ({
    id: 'dispute-1',
    provider: 'mock',
    providerReference: 'du_1',
    paymentId: ACCOUNTING_IDS.payment,
    paymentReference: 'pi_1',
    chargeReference: 'ch_1',
    familyUserId: ACCOUNTING_IDS.family,
    contractId: ACCOUNTING_IDS.contract,
    cycleId: ACCOUNTING_IDS.cycle,
    scope: 'cycle',
    amountCents: 13206,
    currency: 'cad',
    reason: 'fraudulent',
    status: 'lost',
    evidenceDueBy: null,
    chargeRefundable: false,
    hasEvidence: true,
    evidenceSubmissionCount: 1,
    withdrawnCents: 13206,
    reinstatedCents: 0,
    feeCents: 1500,
    triage: 'resolved',
    evidenceSummary: null,
    evidenceSummaryByUserId: null,
    evidenceSummaryAt: null,
    closedAt: new Date('2026-12-01T12:00:00.000Z'),
    providerCreatedAt: new Date('2026-11-06T12:00:00.000Z'),
    syncedAt: new Date('2026-12-01T12:00:00.000Z'),
    noticesSent: [],
    createdAt: new Date('2026-11-06T12:00:00.000Z'),
    updatedAt: new Date('2026-12-01T12:00:00.000Z'),
    ...overrides
  }) as CardDispute;

const session = (overrides: Partial<CardDisputeSession> = {}): CardDisputeSession =>
  ({
    disputeId: 'dispute-1',
    sessionId: 's-1',
    contractId: ACCOUNTING_IDS.contract,
    cycleId: ACCOUNTING_IDS.cycle,
    familyTotalCents: 6603,
    helperShareCents: 5266,
    disputedCents: 6603,
    allocation: null,
    allocationReason: null,
    helperForfeitCents: 0,
    recoveryId: null,
    allocatedByUserId: null,
    allocatedAt: null,
    createdAt: new Date('2026-11-06T12:00:00.000Z'),
    ...overrides
  }) as CardDisputeSession;

describe('what Poppynz bears for card disputes (step-4 adapter)', () => {
  it('a lost dispute: the net debit less what helpers bear, plus the fee', () => {
    const items = borneByPoppynz(
      [dispute()],
      [
        session({ allocation: 'poppynz_absorbs', allocatedByUserId: 'admin' }),
        session({
          sessionId: 's-2',
          allocation: 'helper_not_provided',
          allocationReason: 'no-show',
          helperForfeitCents: 2633,
          allocatedByUserId: 'admin'
        })
      ]
    );
    expect(items.map((item) => [item.id, item.cause, item.amountCents, item.status])).toEqual([
      ['dispute-1:fee', 'card_dispute_fee', 1500, 'lost'],
      ['dispute-1', 'card_dispute', 13206 - 2633, 'lost']
    ]);
    expect(items[1]!.occurredAt).toEqual(new Date('2026-12-01T12:00:00.000Z'));
  });

  it('borne in full until allocated; won costs the fee only; open costs nothing but the fee', () => {
    expect(
      borneByPoppynz([dispute()], [session()]).map((item) => [
        item.cause,
        item.amountCents,
        item.status
      ])
    ).toEqual([
      ['card_dispute_fee', 1500, 'lost'],
      ['card_dispute', 13206, 'lost (allocation pending)']
    ]);
    expect(
      borneByPoppynz([dispute({ status: 'won', reinstatedCents: 13206 })], []).map(
        (item) => item.cause
      )
    ).toEqual(['card_dispute_fee']);
    expect(
      borneByPoppynz([dispute({ status: 'needs_response', closedAt: null })], []).map(
        (item) => item.cause
      )
    ).toEqual(['card_dispute_fee']);
    // An inquiry: no money, no fee.
    expect(
      borneByPoppynz(
        [dispute({ status: 'warning_needs_response', feeCents: 0, withdrawnCents: 0 })],
        []
      )
    ).toEqual([]);
  });

  it('is counted once: an allocation’s own ledger entry is not read again', () => {
    const sources = accountingSources({
      absorbed: [
        absorbedEntry({
          id: 'alloc',
          kind: 'platform_absorbed',
          entryKey: 'card_dispute:dispute-1:s-1:absorbed',
          amountCents: 6603,
          createdAt: new Date('2026-12-01T12:00:00.000Z')
        })
      ]
    });
    const borne = borneByPoppynz(
      [dispute()],
      [session({ allocation: 'poppynz_absorbs', allocatedByUserId: 'admin' })]
    );
    const items = buildObligations(sources, borne);
    expect(items.map((item) => [item.key, item.cause, item.amountCents])).toEqual([
      ['absorbed:card_dispute:dispute-1', 'card_dispute', 13206],
      ['absorbed:card_dispute_fee:dispute-1:fee', 'card_dispute_fee', 1500]
    ]);
    expect(absorbedByMonth(sources, borne, ['2026-11', '2026-12'])).toEqual([
      { month: '2026-11', cause: 'card_dispute_fee', count: 1, amountCents: 1500 },
      { month: '2026-12', cause: 'card_dispute', count: 1, amountCents: 13206 }
    ]);
  });

  it('reads step 4’s records and finds a dispute by its provider reference', async () => {
    const repo = makeInMemoryCardDisputeRepo();
    repo.state.disputes.push(dispute());
    repo.state.sessions.push(session());
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ledger = yield* CardDisputeLedger;
        return {
          borne: yield* ledger.listBorneByPoppynz(),
          found: yield* ledger.findByProviderReference('du_1'),
          missing: yield* ledger.findByProviderReference('du_x')
        };
      }).pipe(
        Effect.provide(
          CardDisputeLedgerLive.pipe(
            Layer.provide(Layer.mergeAll(repo.layer, Layer.succeed(Payments, makeMockPayments())))
          )
        )
      )
    );
    expect(result.borne.map((item) => item.amountCents)).toEqual([1500, 13206]);
    expect(result.borne[1]).toMatchObject({ sessionId: 's-1', providerReference: 'du_1' });
    expect(result.found).toEqual({
      disputeId: 'dispute-1',
      paymentId: ACCOUNTING_IDS.payment,
      amountCents: 13206
    });
    expect(result.missing).toBeNull();
  });
});
