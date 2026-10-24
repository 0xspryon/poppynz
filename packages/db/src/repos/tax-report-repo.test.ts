import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { PaymentTaxLine } from '../schema';
import { makeInMemoryTaxReportRepo, TaxReportRepo, TaxReportRepoDefault } from './tax-report-repo';

const line: PaymentTaxLine = {
  supplyType: 'credibled_check',
  jurisdiction: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  baseCents: 5500,
  taxCents: 715,
  label: 'HST (ON) 13%',
  registrationNumber: null
};

describe('makeInMemoryTaxReportRepo', () => {
  it('keeps the sources captured in [from, to)', async () => {
    const layer = makeInMemoryTaxReportRepo([
      { source: 'payment', id: 'a', capturedAt: new Date('2026-11-01T00:00:00Z'), taxLines: [line] },
      { source: 'payment', id: 'b', capturedAt: new Date('2026-12-01T00:00:00Z'), taxLines: [line] }
    ]);
    const rows = await Effect.runPromise(
      TaxReportRepo.pipe(
        Effect.flatMap((repo) =>
          repo.listCollected({
            from: new Date('2026-11-01T00:00:00Z'),
            to: new Date('2026-12-01T00:00:00Z')
          })
        ),
        Effect.provide(layer)
      )
    );
    expect(rows.map((row) => row.id)).toEqual(['a']);
  });
});

// Against a real Postgres with migrations applied: run with
// TAX_REPO_TEST_DATABASE_URL=postgres://… bun test — a THROWAWAY database
// (it inserts a user and payments).
const liveUrl = process.env.TAX_REPO_TEST_DATABASE_URL;
describe.skipIf(!liveUrl)('TaxReportRepoLive (Postgres)', () => {
  it('reads captured one-off payments, never contract payments or refunded ones', async () => {
    process.env.DATABASE_URL = liveUrl;
    const { db } = await import('../db');
    const { payment, user } = await import('../schema');
    const userId = `tax-report-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: 'tax report',
      email: `${userId}@example.test`,
      emailVerified: true,
      role: 'family'
    });
    // A capture instant of its own, so earlier runs never match.
    const capturedAt = new Date(Date.UTC(2030, 0, 1) + Date.now() % 1_000_000_000);
    const base = {
      userId,
      provider: 'mock',
      amountCents: 5500,
      feeCents: 0,
      taxCents: 715,
      totalCents: 6215,
      taxLines: [line],
      capturedAt
    };
    const [kept] = await db
      .insert(payment)
      .values([
        { ...base, kind: 'credibled_order', status: 'captured' },
        { ...base, kind: 'contract_cycle', status: 'captured' },
        { ...base, kind: 'credibled_order', status: 'refunded' }
      ])
      .returning();
    const rows = await Effect.runPromise(
      TaxReportRepo.pipe(
        Effect.flatMap((repo) =>
          repo.listCollected({ from: capturedAt, to: new Date(capturedAt.getTime() + 1000) })
        ),
        Effect.provide(TaxReportRepoDefault)
      )
    );
    expect(rows.map((row) => [row.source, row.id])).toEqual([['payment', kept!.id]]);
    expect(rows[0]!.taxLines).toEqual([line]);
  });
});
