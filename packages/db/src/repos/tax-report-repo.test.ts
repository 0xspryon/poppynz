import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import type { PaymentTaxLine } from '../schema';
import {
  makeInMemoryTaxReportRepo,
  sessionRefundTaxSource,
  TaxReportRepo,
  TaxReportRepoDefault
} from './tax-report-repo';

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
      {
        source: 'payment',
        id: 'a',
        capturedAt: new Date('2026-11-01T00:00:00Z'),
        taxLines: [line]
      },
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
    const capturedAt = new Date(Date.UTC(2030, 0, 1) + (Date.now() % 1_000_000_000));
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

describe('sessionRefundTaxSource (Tier 3 step 5)', () => {
  it('negates the returned lines, as a handled refund when asked', () => {
    const source = sessionRefundTaxSource(
      {
        id: 'r-1',
        refundedAt: new Date('2026-11-15T12:00:00Z'),
        careTaxLines: [],
        feeTaxLines: [{ ...line, supplyType: 'family_fee', baseCents: 312, taxCents: 41 }],
        commissionTaxLines: [
          { ...line, supplyType: 'provider_commission', baseCents: 937, taxCents: 122 }
        ]
      },
      'session_refund_handled'
    );
    expect(source.source).toBe('session_refund_handled');
    expect(source.taxLines.map((row) => [row.supplyType, row.baseCents, row.taxCents])).toEqual([
      ['family_fee', -312, -41],
      ['provider_commission', -937, -122]
    ]);
  });
});

// The same throwaway database, with fixtures written under
// `session_replication_role = replica` (no foreign keys to satisfy).
describe.skipIf(!liveUrl)('TaxReportRepoLive handled refunds (Postgres)', () => {
  it('counts a refund marked handled in the month it was marked, never a cancelled one', async () => {
    process.env.DATABASE_URL = liveUrl;
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: liveUrl });
    await client.connect();
    const base = Date.UTC(2031, 0, 1) + (Date.now() % 1_000_000_000);
    const handledAt = new Date(base);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const fee = [{ ...line, supplyType: 'family_fee', baseCents: 312, taxCents: 41 }];
    const commission = [
      { ...line, supplyType: 'provider_commission', baseCents: 937, taxCents: 122 }
    ];
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      const insert = (
        id: string,
        status: string,
        handled: Date | null,
        resolvedBy: string | null
      ) =>
        client.query(
          `insert into app_db.session_refunds (id, refund_key, session_id, resolution_id, cycle_id, contract_id, payment_id,
             care_cents, care_tax_lines, care_tax_cents, fee_cents, fee_tax_lines, fee_tax_cents, total_cents,
             commission_cents, commission_tax_lines, status, resolved_by_user_id, resolved_note, handled_at, updated_at)
           values ($1::uuid, $1::text, $2::uuid, $2::uuid, $2::uuid, $2::uuid, $2::uuid, 5000, '[]', 0, 312, $3, 41, 5353, 937, $4, $5, $6, 'paid by e-Transfer', $7, $8)`,
          [
            id,
            crypto.randomUUID(),
            JSON.stringify(fee),
            JSON.stringify(commission),
            status,
            resolvedBy,
            handled,
            handledAt
          ]
        );
      // Handled (counts), handled a month later (outside), cancelled without
      // being handled (never counts).
      await insert(ids[0]!, 'cancelled', handledAt, 'accountant-1');
      await insert(ids[1]!, 'cancelled', new Date(base + 40 * 86_400_000), 'accountant-1');
      await insert(ids[2]!, 'pending', null, null);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const rows = await Effect.runPromise(
      TaxReportRepo.pipe(
        Effect.flatMap((repo) =>
          repo.listCollected({ from: handledAt, to: new Date(handledAt.getTime() + 1000) })
        ),
        Effect.provide(TaxReportRepoDefault)
      )
    );
    expect(rows.map((row) => [row.source, row.id])).toEqual([['session_refund_handled', ids[0]]]);
    expect(rows[0]!.capturedAt).toEqual(handledAt);
    expect(rows[0]!.taxLines.reduce((total, row) => total + row.taxCents, 0)).toBe(-163);
  });
});
