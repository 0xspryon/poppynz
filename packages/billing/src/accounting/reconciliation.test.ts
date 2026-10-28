import { describe, expect, it } from 'bun:test';
import {
  dummyPayoutAccount,
  makeInMemoryPayoutAccountRepo,
  makeInMemoryReconciliationRepo,
  makeInMemorySessionMoneyRepo,
  ReconciliationRepo
} from '@repo/db';
import { makeMailerTest } from '@repo/mail';
import { makeMockPayments, Payments, type ProviderBalanceTransaction } from '@repo/payments';
import { ConfigProvider, Effect, Either, Layer } from 'effect';
import { handlePayoutEvent } from '../contracts/money';
import { makeCardDisputeLedgerTest } from './card-dispute-adapter';
import { runReconciliation, runScheduledReconciliation, unmatchedOurs } from './reconciliation';

const NOW = new Date('2026-10-28T06:00:00.000Z');
const FROM = new Date('2026-10-01T00:00:00.000Z');

const txn = (
  reference: string,
  overrides: Partial<ProviderBalanceTransaction> = {}
): ProviderBalanceTransaction => ({
  reference,
  type: 'charge',
  reportingCategory: 'charge',
  amountCents: 6602,
  feeCents: 274,
  netCents: 6328,
  currency: 'cad',
  status: 'available',
  createdAt: new Date('2026-10-20T12:00:00.000Z'),
  availableOn: new Date('2026-10-22T00:00:00.000Z'),
  description: null,
  sourceReference: `ch_${reference}`,
  sourceType: 'charge',
  paymentReference: `pi_${reference}`,
  transferReference: null,
  feeDetails: [],
  ...overrides
});

const seed = () => ({
  payments: [
    {
      id: 'pay-1',
      kind: 'contract_cycle',
      providerReference: 'pi_c1',
      refundReference: null,
      status: 'captured',
      totalCents: 6602,
      capturedCents: 6602,
      capturedAt: new Date('2026-10-20T12:00:00.000Z'),
      refundedAt: null,
      provider: 'mock'
    },
    {
      id: 'pay-2',
      kind: 'contract_cycle',
      providerReference: 'pi_c2',
      refundReference: null,
      status: 'captured',
      totalCents: 5000,
      capturedCents: 5000,
      capturedAt: new Date('2026-10-20T12:00:00.000Z'),
      refundedAt: null,
      provider: 'mock'
    },
    {
      id: 'check-1',
      kind: 'credibled_order',
      providerReference: 'pi_k',
      refundReference: 're_k',
      status: 'refunded',
      totalCents: 6215,
      capturedCents: null,
      capturedAt: new Date('2026-10-02T00:00:00.000Z'),
      refundedAt: new Date('2026-10-03T00:00:00.000Z'),
      provider: 'mock'
    },
    {
      // Captured in the period, absent from the provider's list.
      id: 'pay-missing',
      kind: 'contract_cycle',
      providerReference: 'pi_missing',
      refundReference: null,
      status: 'captured',
      totalCents: 100,
      capturedCents: 100,
      capturedAt: new Date('2026-10-21T00:00:00.000Z'),
      refundedAt: null,
      provider: 'mock'
    }
  ],
  refunds: [
    {
      id: 'ref-1',
      providerReference: 're_s1',
      totalCents: 5039,
      status: 'succeeded',
      refundedAt: new Date('2026-10-21T00:00:00.000Z')
    }
  ],
  transfers: [
    {
      id: 'tr-row-1',
      helperUserId: 'helper-1',
      providerReference: 'tr_1',
      amountCents: 4212,
      status: 'sent',
      sentAt: new Date('2026-10-22T00:00:00.000Z'),
      paidAt: null,
      payoutReference: null,
      payoutMatch: null
    },
    {
      id: 'tr-row-2',
      helperUserId: 'helper-1',
      providerReference: 'tr_2',
      amountCents: 1563,
      status: 'sent',
      sentAt: new Date('2026-10-23T00:00:00.000Z'),
      paidAt: null,
      payoutReference: null,
      payoutMatch: null
    }
  ],
  accounts: [{ helperUserId: 'helper-1', accountReference: 'acct_1' }]
});

const platformTransactions = [
  txn('c1'),
  txn('c2', { amountCents: 5100, netCents: 4826 }),
  txn('unknown'),
  txn('rf', {
    type: 'refund',
    reportingCategory: 'refund',
    amountCents: -5039,
    feeCents: 0,
    netCents: -5039,
    sourceReference: 're_s1',
    sourceType: 'refund',
    paymentReference: 'pi_c1'
  }),
  txn('rk', {
    type: 'refund',
    reportingCategory: 'refund',
    amountCents: -6215,
    feeCents: 0,
    netCents: -6215,
    sourceReference: 're_k',
    sourceType: 'refund',
    paymentReference: 'pi_k'
  }),
  txn('t1', {
    type: 'transfer',
    reportingCategory: 'transfer',
    amountCents: -4212,
    feeCents: 0,
    netCents: -4212,
    sourceReference: 'tr_1',
    sourceType: 'transfer',
    paymentReference: null
  }),
  txn('po', {
    type: 'payout',
    reportingCategory: 'payout',
    amountCents: -10000,
    feeCents: 0,
    netCents: -10000,
    sourceReference: 'po_platform',
    sourceType: 'payout',
    paymentReference: null
  }),
  txn('fee', {
    type: 'stripe_fee',
    reportingCategory: 'fee',
    amountCents: -7,
    feeCents: 0,
    netCents: -7,
    sourceReference: null,
    sourceType: null,
    paymentReference: null
  }),
  txn('dk', {
    type: 'adjustment',
    reportingCategory: 'dispute',
    amountCents: -5000,
    feeCents: 1500,
    netCents: -6500,
    sourceReference: 'du_known',
    sourceType: 'dispute',
    paymentReference: 'pi_c2'
  }),
  txn('du', {
    type: 'adjustment',
    reportingCategory: 'dispute',
    amountCents: -5000,
    feeCents: 1500,
    netCents: -6500,
    sourceReference: 'du_unknown',
    sourceType: 'dispute',
    paymentReference: 'pi_x'
  })
];

const world = (settings: Record<string, string> = {}) => {
  const payments = makeMockPayments();
  payments.setBalanceTransactions(null, platformTransactions);
  const repo = makeInMemoryReconciliationRepo(seed());
  const layer = Layer.mergeAll(
    Layer.succeed(Payments, payments),
    repo.layer,
    makeCardDisputeLedgerTest([], {
      du_known: { disputeId: 'dispute-1', paymentId: 'pay-2', amountCents: 5000 }
    })
  );
  const provide = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      Payments | ReconciliationRepo | import('./card-dispute-adapter').CardDisputeLedger
    >
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(layer),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(settings))))
      )
    );
  return { payments, repo, provide };
};

const manual = (now = NOW) =>
  runReconciliation({ trigger: 'manual', requestedByUserId: 'acct-1', from: FROM, to: now, now });

const byReference = (rows: ReadonlyArray<{ reference: string }>, reference: string) =>
  rows.find((row) => row.reference === reference) as Record<string, unknown> | undefined;

describe('reconciliation matching', () => {
  it('matches each provider transaction to ours by reference, and lists the rest', async () => {
    const w = world();
    const summary = await w.provide(manual());
    const rows = w.repo.state.transactions;
    expect(byReference(rows, 'c1')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'payment',
      matchedId: 'pay-1'
    });
    expect(byReference(rows, 'c2')).toMatchObject({
      matchStatus: 'mismatch',
      matchKind: 'payment',
      matchNote: 'amount 5100 at the provider, 5000 on our side'
    });
    expect(byReference(rows, 'unknown')).toMatchObject({
      matchStatus: 'unmatched',
      matchNote: 'no payment of ours for this charge'
    });
    expect(byReference(rows, 'rf')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'session_refund',
      matchedId: 'ref-1'
    });
    expect(byReference(rows, 'rk')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'payment_refund',
      matchedId: 'check-1'
    });
    expect(byReference(rows, 't1')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'helper_transfer',
      matchedId: 'tr-row-1'
    });
    expect(byReference(rows, 'po')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'platform_payout'
    });
    expect(byReference(rows, 'fee')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'stripe_fee'
    });
    expect(byReference(rows, 'dk')).toMatchObject({
      matchStatus: 'matched',
      matchKind: 'card_dispute',
      matchedId: 'dispute-1'
    });
    expect(byReference(rows, 'du')).toMatchObject({
      matchStatus: 'unmatched',
      matchNote: 'no card dispute on file for this dispute'
    });
    expect(summary).toMatchObject({ imported: 10, matched: 7, unmatched: 3 });
    expect(summary.run).toMatchObject({ status: 'succeeded', trigger: 'manual', pages: 1 });

    // Our side: the captured payment the provider never listed, and the
    // transfer it didn't list either.
    const ours = unmatchedOurs(
      await w.provide(
        ReconciliationRepo.pipe(
          Effect.flatMap((repo) =>
            repo.ourRecordsBetween({ provider: 'mock', from: FROM, to: NOW })
          )
        )
      ),
      rows
    );
    expect(ours.map((row) => row.key)).toEqual(['payment:pay-missing', 'helper_transfer:tr-row-2']);
  });

  it('reads every page, and re-importing changes no count', async () => {
    const w = world({ RECONCILIATION_PAGE_SIZE: '3' });
    const first = await w.provide(manual());
    expect(first.run.pages).toBe(4);
    expect(w.repo.state.transactions).toHaveLength(10);
    const second = await w.provide(manual(new Date(NOW.getTime() + 60_000)));
    expect(w.repo.state.transactions).toHaveLength(10);
    expect(new Set(w.repo.state.transactions.map((row) => row.lastRunId))).toEqual(
      new Set([second.run.id])
    );
    expect(new Set(w.repo.state.transactions.map((row) => row.firstRunId))).toEqual(
      new Set([first.run.id])
    );
  });

  it('stops at the page limit and says it is incomplete', async () => {
    const w = world({ RECONCILIATION_PAGE_SIZE: '3', RECONCILIATION_MAX_PAGES: '2' });
    const summary = await w.provide(manual());
    expect(summary.run).toMatchObject({
      status: 'incomplete',
      pages: 2,
      error: 'stopped after 2 pages'
    });
    expect(w.repo.state.transactions).toHaveLength(6);
  });

  it('refuses a second run while one is running', async () => {
    const w = world();
    await w.provide(
      ReconciliationRepo.pipe(
        Effect.flatMap((repo) =>
          repo.startRun({
            provider: 'mock',
            trigger: 'schedule',
            requestedByUserId: null,
            periodFrom: FROM,
            periodTo: NOW,
            startedAt: NOW,
            staleBefore: new Date(0)
          })
        )
      )
    );
    const result = await w.provide(manual().pipe(Effect.either));
    expect(Either.isLeft(result) && result.left._tag).toBe('ReconciliationBusyError');
  });

  it('records a provider outage as a failed run', async () => {
    const payments = makeMockPayments({ providerDown: true });
    const repo = makeInMemoryReconciliationRepo(seed());
    const summary = await Effect.runPromise(
      manual().pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(Payments, payments), repo.layer, makeCardDisputeLedgerTest())
        )
      )
    );
    expect(summary.run).toMatchObject({ status: 'failed' });
    expect(summary.run.error).toStartWith('provider:');
  });

  it('runs on schedule once the interval has passed', async () => {
    const w = world({ RECONCILIATION_INTERVAL_HOURS: '24', RECONCILIATION_LOOKBACK_DAYS: '35' });
    const first = await w.provide(runScheduledReconciliation(NOW));
    expect(first?.run).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect(first?.run.periodFrom).toEqual(new Date(NOW.getTime() - 35 * 86_400_000));
    expect(
      await w.provide(runScheduledReconciliation(new Date(NOW.getTime() + 23 * 3600_000)))
    ).toBeNull();
    const next = await w.provide(
      runScheduledReconciliation(new Date(NOW.getTime() + 24 * 3600_000))
    );
    expect(next?.run.id).not.toBe(first?.run.id);
  });

  it('tries a failed scheduled run again an hour later, not a whole interval later', async () => {
    const repo = makeInMemoryReconciliationRepo(seed());
    const at = (providerDown: boolean, now: Date) => {
      const payments = makeMockPayments({ providerDown });
      payments.setBalanceTransactions(null, platformTransactions);
      return Effect.runPromise(
        runScheduledReconciliation(now).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Payments, payments),
              repo.layer,
              makeCardDisputeLedgerTest()
            )
          )
        )
      );
    };
    expect((await at(true, NOW))?.run.status).toBe('failed');
    expect(await at(false, new Date(NOW.getTime() + 59 * 60_000))).toBeNull();
    expect((await at(false, new Date(NOW.getTime() + 60 * 60_000)))?.run.status).toBe('succeeded');
    expect(await at(false, new Date(NOW.getTime() + 2 * 3600_000))).toBeNull();
  });
});

describe('paid to the bank (§13.4)', () => {
  const arrival = (reference: string, transfer: string) =>
    txn(reference, {
      type: 'payment',
      sourceReference: `py_${reference}`,
      paymentReference: null,
      transferReference: transfer
    });

  it('marks exactly the transfers an automatic payout paid out; a manual payout is left alone', async () => {
    const w = world();
    const payout = {
      status: 'paid' as const,
      amountCents: 4212,
      arrivalDate: new Date('2026-10-25T00:00:00.000Z'),
      createdAt: new Date('2026-10-24T00:00:00.000Z'),
      failureReason: null
    };
    w.payments.setPayout('acct_1', { ...payout, reference: 'po_auto', automatic: true });
    w.payments.setPayout('acct_1', { ...payout, reference: 'po_manual', automatic: false });
    w.payments.setPayoutTransactions('acct_1', 'po_auto', [
      arrival('a1', 'tr_1'),
      txn('pay', {
        type: 'payout',
        reportingCategory: 'payout',
        amountCents: -4212,
        feeCents: 0,
        netCents: -4212,
        sourceReference: 'po_auto',
        sourceType: 'payout',
        paymentReference: null
      })
    ]);
    const summary = await w.provide(manual());
    expect(summary.payoutsExact).toBe(1);
    expect(
      w.repo.state.transfers.map((row) => [
        row.id,
        row.status,
        row.payoutMatch,
        row.payoutReference
      ])
    ).toEqual([
      ['tr-row-1', 'paid', 'exact', 'po_auto'],
      ['tr-row-2', 'sent', null, null]
    ]);
    expect(byReference(w.repo.state.transactions, 'a1')).toMatchObject({
      account: 'acct_1',
      payoutReference: 'po_auto',
      matchKind: 'transfer_arrival',
      matchedId: 'tr_1'
    });
    expect(byReference(w.repo.state.transactions, 'pay')).toMatchObject({
      matchKind: 'helper_payout'
    });
  });

  it('the payout webhook matches exactly when it can, else approximately (labelled)', async () => {
    const run = async (automatic: boolean) => {
      const payments = makeMockPayments();
      payments.setPayout('acct_1', {
        reference: 'po_1',
        status: 'paid',
        amountCents: 4212,
        arrivalDate: new Date('2026-10-25T00:00:00.000Z'),
        createdAt: new Date('2026-10-24T00:00:00.000Z'),
        failureReason: null,
        automatic
      });
      payments.setPayoutTransactions('acct_1', 'po_1', [arrival('a1', 'tr_1')]);
      const money = makeInMemorySessionMoneyRepo();
      const transfer = await Effect.runPromise(
        money.service.ensureTransfer({
          cycleId: 'cycle-1',
          contractId: 'contract-1',
          helperUserId: 'helper-1',
          sequence: 1,
          status: 'sent',
          dueAt: new Date('2026-10-22T00:00:00.000Z')
        })
      );
      await Effect.runPromise(
        money.service.advanceTransfer(transfer.id, {
          from: ['sent'],
          set: { providerReference: 'tr_1', sentAt: new Date('2026-10-22T00:00:00.000Z') }
        })
      );
      const recon = makeInMemoryReconciliationRepo({
        transfers: [
          {
            id: transfer.id,
            helperUserId: 'helper-1',
            providerReference: 'tr_1',
            amountCents: 4212,
            status: 'sent',
            sentAt: new Date('2026-10-22T00:00:00.000Z'),
            paidAt: null,
            payoutReference: null,
            payoutMatch: null
          }
        ]
      });
      const note = await Effect.runPromise(
        handlePayoutEvent('acct_1', 'po_1').pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(Payments, payments),
              money.layer,
              recon.layer,
              makeMailerTest({}),
              makeInMemoryPayoutAccountRepo([
                dummyPayoutAccount({ userId: 'helper-1', accountReference: 'acct_1' })
              ]).layer
            )
          )
        )
      );
      return { note, money: money.state.transfers[0], recon: recon.state.transfers[0] };
    };
    const exact = await run(true);
    expect(exact.note).toBe('paid: 1 transfer(s) arrived (exact)');
    expect(exact.recon).toMatchObject({
      status: 'paid',
      payoutMatch: 'exact',
      payoutReference: 'po_1'
    });
    const approximate = await run(false);
    expect(approximate.note).toBe('paid: 1 transfer(s) arrived (approximate)');
    expect(approximate.money).toMatchObject({
      status: 'paid',
      payoutMatch: 'approximate',
      payoutReference: 'po_1'
    });
  });
});
