import { makeCardDisputeLedgerTest } from '@repo/billing';
import { makeInMemoryReconciliationRepo, ReconciliationRepo } from '@repo/db';
import { makeMockPayments, Payments } from '@repo/payments';
import { ConfigProvider, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { processReconciliationTick } from './reconciliation-processor';

const NOW = new Date('2026-10-28T06:00:00.000Z');

const world = (settings: Record<string, string> = {}) => {
  const payments = makeMockPayments();
  payments.setBalanceTransactions(null, [
    {
      reference: 'txn_1',
      type: 'stripe_fee',
      reportingCategory: 'fee',
      amountCents: -7,
      feeCents: 0,
      netCents: -7,
      currency: 'cad',
      status: 'available',
      createdAt: new Date('2026-10-20T00:00:00.000Z'),
      availableOn: new Date('2026-10-20T00:00:00.000Z'),
      description: null,
      sourceReference: null,
      sourceType: null,
      paymentReference: null,
      transferReference: null,
      feeDetails: []
    }
  ]);
  const repo = makeInMemoryReconciliationRepo();
  const run = (now: Date) =>
    Effect.runPromise(
      processReconciliationTick(now).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(Payments, payments), repo.layer, makeCardDisputeLedgerTest())
        ),
        Effect.withConfigProvider(ConfigProvider.fromMap(new Map(Object.entries(settings))))
      )
    );
  return { repo, run };
};

describe('processReconciliationTick', () => {
  it('imports once per interval (24 h by default) over the lookback window', async () => {
    const w = world();
    expect(await w.run(NOW)).toBe(
      'reconciliation: succeeded, 1 imported, 1 matched, 0 unmatched, 0 transfer(s) matched to their payout'
    );
    expect(w.repo.state.runs[0]).toMatchObject({ trigger: 'schedule' });
    expect(w.repo.state.runs[0]!.periodFrom).toEqual(new Date(NOW.getTime() - 35 * 86_400_000));
    expect(await w.run(new Date(NOW.getTime() + 15 * 60_000))).toBe('reconciliation: not due');
    expect(await w.run(new Date(NOW.getTime() + 24 * 3600_000))).toMatch(
      /^reconciliation: succeeded/
    );
    expect(w.repo.state.runs).toHaveLength(2);
  });

  it('honours RECONCILIATION_INTERVAL_HOURS', async () => {
    const w = world({ RECONCILIATION_INTERVAL_HOURS: '6' });
    await w.run(NOW);
    expect(await w.run(new Date(NOW.getTime() + 6 * 3600_000))).toMatch(
      /^reconciliation: succeeded/
    );
  });

  it('never fails the billing job on a bad setting', async () => {
    const w = world({ RECONCILIATION_INTERVAL_HOURS: 'daily' });
    expect(await w.run(NOW)).toBe('reconciliation: could not start (see the log)');
  });

  it('waits while another run is in progress', async () => {
    const w = world();
    await Effect.runPromise(
      ReconciliationRepo.pipe(
        Effect.flatMap((repo) =>
          repo.startRun({
            provider: 'mock',
            trigger: 'manual',
            requestedByUserId: null,
            periodFrom: new Date(0),
            periodTo: NOW,
            startedAt: NOW,
            staleBefore: new Date(0)
          })
        ),
        Effect.provide(w.repo.layer)
      )
    );
    expect(await w.run(NOW)).toBe('reconciliation: not due');
  });
});
