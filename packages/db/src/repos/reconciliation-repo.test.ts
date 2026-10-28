import { describe, expect, it } from 'bun:test';
import { Effect, Layer } from 'effect';
import {
  makeInMemoryReconciliationRepo,
  ReconciliationRepo,
  upsertBatches,
  type BalanceTransactionUpsert
} from './reconciliation-repo';

const txn = (reference: string, overrides: Partial<BalanceTransactionUpsert> = {}) =>
  ({
    provider: 'stripe',
    reference,
    account: null,
    type: 'charge',
    reportingCategory: 'charge',
    amountCents: 6602,
    feeCents: 274,
    netCents: 6328,
    currency: 'cad',
    status: 'pending',
    providerCreatedAt: new Date('2026-10-20T12:00:00.000Z'),
    availableOn: new Date('2026-10-27T00:00:00.000Z'),
    description: null,
    sourceReference: `ch_${reference}`,
    sourceType: 'charge',
    paymentReference: `pi_${reference}`,
    transferReference: null,
    payoutReference: null,
    feeDetails: [],
    matchStatus: 'unmatched',
    matchKind: null,
    matchedId: null,
    matchNote: null,
    ...overrides
  }) satisfies BalanceTransactionUpsert;

const run = <A, E>(
  layer: Layer.Layer<ReconciliationRepo, unknown>,
  effect: Effect.Effect<A, E, ReconciliationRepo>
) => Effect.runPromise(Effect.provide(effect, layer));

const startInput = (startedAt: Date) => ({
  provider: 'stripe',
  trigger: 'schedule' as const,
  requestedByUserId: null,
  periodFrom: new Date('2026-09-23T00:00:00.000Z'),
  periodTo: new Date('2026-10-28T00:00:00.000Z'),
  startedAt,
  staleBefore: new Date(startedAt.getTime() - 6 * 3600_000)
});

/** Shared by the in-memory stand-in and the Postgres repo: the same rules. */
const contract = (
  makeLayer: () => Promise<{ layer: Layer.Layer<ReconciliationRepo, unknown>; provider: string }>
) => {
  it('runs one at a time; a stale running run is abandoned', async () => {
    const { layer, provider } = await makeLayer();
    const at = new Date('2026-10-28T06:00:00.000Z');
    const first = await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.startRun({ ...startInput(at), provider })))
    );
    expect(first?.status).toBe('running');
    const second = await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.startRun({ ...startInput(at), provider })))
    );
    expect(second).toBeNull();
    const later = new Date(at.getTime() + 7 * 3600_000);
    const third = await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.startRun({ ...startInput(later), provider })))
    );
    expect(third?.id).not.toBe(first?.id);
    const finished = await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.finishRun(third!.id, {
            status: 'succeeded',
            importedCount: 1,
            matchedCount: 1,
            unmatchedCount: 0,
            payoutsExactCount: 0,
            pages: 1,
            error: null,
            finishedAt: later
          })
        )
      )
    );
    expect(finished?.status).toBe('succeeded');
    const runs = await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.listRuns(provider, 10)))
    );
    expect(runs.map((row) => row.status)).toEqual(['succeeded', 'failed']);
  });

  it('re-imports idempotently by reference, updating status and match', async () => {
    const { layer, provider } = await makeLayer();
    const at = new Date('2026-10-28T06:00:00.000Z');
    const runRow = (await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.startRun({ ...startInput(at), provider })))
    ))!;
    await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.upsertTransactions(runRow.id, [txn('a', { provider }), txn('b', { provider })])
        )
      )
    );
    await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.upsertTransactions(runRow.id, [
            txn('a', {
              provider,
              status: 'available',
              matchStatus: 'matched',
              matchKind: 'payment',
              matchedId: 'p-1'
            })
          ])
        )
      )
    );
    const rows = await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.listTransactions({
            provider,
            from: new Date('2026-10-01T00:00:00Z'),
            to: new Date('2026-11-01T00:00:00Z')
          })
        )
      )
    );
    expect(rows.filter((row) => row.reference === 'a')).toHaveLength(1);
    expect(rows.find((row) => row.reference === 'a')).toMatchObject({
      status: 'available',
      matchStatus: 'matched',
      matchKind: 'payment',
      matchedId: 'p-1'
    });
    expect(rows).toHaveLength(2);
  });

  it('imports more rows than one insert can bind, and a reference read twice once', async () => {
    const { layer, provider } = await makeLayer();
    const at = new Date('2026-10-28T06:00:00.000Z');
    const runRow = (await run(
      layer,
      ReconciliationRepo.pipe(Effect.flatMap((r) => r.startRun({ ...startInput(at), provider })))
    ))!;
    // 2,600 rows × 28 columns is above Postgres's 65,535 bind parameters.
    const many = Array.from({ length: 2600 }, (_, index) => txn(`bulk-${index}`, { provider }));
    await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.upsertTransactions(runRow.id, [
            ...many,
            txn('bulk-0', { provider, status: 'available' })
          ])
        )
      )
    );
    const rows = await run(
      layer,
      ReconciliationRepo.pipe(
        Effect.flatMap((r) =>
          r.listTransactions({
            provider,
            from: new Date('2026-10-01T00:00:00Z'),
            to: new Date('2026-11-01T00:00:00Z')
          })
        )
      )
    );
    expect(rows).toHaveLength(2600);
    expect(rows.find((row) => row.reference === 'bulk-0')?.status).toBe('available');
  });
};

describe('upsertBatches', () => {
  it('keeps the last row per reference and splits into batches', () => {
    const batches = upsertBatches(
      [txn('a'), txn('b'), txn('a', { status: 'available' }), txn('c')],
      2
    );
    expect(batches.map((batch) => batch.map((row) => row.reference))).toEqual([['a', 'b'], ['c']]);
    expect(batches[0]![0]!.status).toBe('available');
  });
});

describe('in-memory ReconciliationRepo', () => {
  contract(async () => ({ layer: makeInMemoryReconciliationRepo().layer, provider: 'stripe' }));

  it('marks the transfers a payout paid exactly, once', async () => {
    const memory = makeInMemoryReconciliationRepo({
      transfers: [
        {
          id: 't-1',
          helperUserId: 'h-1',
          providerReference: 'tr_1',
          amountCents: 4212,
          status: 'sent',
          sentAt: new Date('2026-10-20T00:00:00Z'),
          paidAt: null,
          payoutReference: null,
          payoutMatch: null
        },
        {
          id: 't-2',
          helperUserId: 'h-1',
          providerReference: 'tr_2',
          amountCents: 100,
          status: 'paid',
          sentAt: new Date('2026-10-20T00:00:00Z'),
          paidAt: new Date('2026-10-22T00:00:00Z'),
          payoutReference: null,
          payoutMatch: 'approximate'
        }
      ]
    });
    const mark = ReconciliationRepo.pipe(
      Effect.flatMap((r) =>
        r.markTransfersPaidExactly({
          transferReferences: ['tr_1', 'tr_2'],
          payoutReference: 'po_1',
          paidAt: new Date('2026-10-25T00:00:00Z')
        })
      )
    );
    expect(await run(memory.layer, mark)).toBe(2);
    expect(await run(memory.layer, mark)).toBe(0);
    expect(
      memory.state.transfers.map((row) => [row.status, row.payoutMatch, row.payoutReference])
    ).toEqual([
      ['paid', 'exact', 'po_1'],
      ['paid', 'exact', 'po_1']
    ]);
  });
});

// Against a real Postgres with migrations applied: run with
// RECONCILIATION_REPO_TEST_DATABASE_URL=postgres://… bun test — a THROWAWAY
// database (it inserts runs and transactions).
const liveUrl = process.env.RECONCILIATION_REPO_TEST_DATABASE_URL;
describe.skipIf(!liveUrl)('ReconciliationRepoLive (Postgres)', () => {
  contract(async () => {
    process.env.DATABASE_URL = liveUrl;
    const { ReconciliationRepoDefault } = await import('./reconciliation-repo');
    // A provider name of its own per test, so earlier runs never interfere.
    return { layer: ReconciliationRepoDefault, provider: `test-${crypto.randomUUID()}` };
  });
});
