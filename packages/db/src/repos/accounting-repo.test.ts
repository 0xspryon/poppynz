import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  AccountingRepo,
  makeInMemoryAccountingRepo,
  OBLIGATION_AUDIT_ENTITY
} from './accounting-repo';

describe('in-memory AccountingRepo', () => {
  it('appends marks and returns them with the sources and the trail', async () => {
    const memory = makeInMemoryAccountingRepo();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AccountingRepo;
        yield* repo.appendMark({
          entity: OBLIGATION_AUDIT_ENTITY,
          entityId: 'family_refund:r-1',
          action: 'note',
          actorUserId: 'accountant-1',
          note: 'Bank says next week'
        });
        const sources = yield* repo.listSources();
        const trail = yield* repo.trail({
          audit: [{ entity: OBLIGATION_AUDIT_ENTITY, entityId: 'family_refund:r-1' }],
          sessionId: null,
          cycleId: null
        });
        return { sources, trail };
      }).pipe(Effect.provide(memory.layer))
    );
    expect(result.sources.marks.map((row) => row.note)).toEqual(['Bank says next week']);
    expect(result.trail.audit).toHaveLength(1);
  });
});

// Against a real Postgres with migrations applied (a THROWAWAY database):
// ACCOUNTING_REPO_TEST_DATABASE_URL=postgres://… bun test. Fixtures are
// written under `session_replication_role = replica` (no foreign keys).
const liveUrl = process.env.ACCOUNTING_REPO_TEST_DATABASE_URL;
describe.skipIf(!liveUrl)('AccountingRepoLive (Postgres)', () => {
  it('reads refunds, recoveries, absorbed entries and marks with their contract and people', async () => {
    process.env.DATABASE_URL = liveUrl;
    const { AccountingRepoDefault } = await import('./accounting-repo');
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: liveUrl });
    await client.connect();
    const [refundId, contractId, sessionId, cycleId, paymentId, recoveryId] = Array.from(
      { length: 6 },
      () => crypto.randomUUID()
    );
    const family = `family-${refundId}`;
    const helper = `helper-${refundId}`;
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      for (const [id, name] of [
        [family, 'Fiona Family'],
        [helper, 'Hana Helper']
      ]) {
        await client.query(
          `insert into app_db."user" (id, name, email, email_verified, role) values ($1, $2, $1 || '@example.test', true, 'family')`,
          [id, name]
        );
      }
      await client.query(
        `insert into app_db.contracts (id, conversation_id, family_user_id, provider_user_id, status)
         values ($1::uuid, $1::uuid, $2, $3, 'active')`,
        [contractId, family, helper]
      );
      await client.query(
        `insert into app_db.contract_sessions (id, contract_id, cycle_id, date, slot, service_id, service_name,
           start_minutes, end_minutes, starts_at, ends_at, elapsed_minutes, rate_cents, value_cents)
         values ($1::uuid, $2::uuid, $3::uuid, '2026-11-05', 's@540', 's', 'Babysitting', 540, 780, now(), now(), 240, 2500, 10000)`,
        [sessionId, contractId, cycleId]
      );
      await client.query(
        `insert into app_db.session_refunds (id, refund_key, session_id, resolution_id, cycle_id, contract_id, payment_id,
           care_cents, care_tax_lines, care_tax_cents, fee_cents, fee_tax_lines, fee_tax_cents, total_cents, status)
         values ($1::uuid, $1::text, $2::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 5000, '[]', 0, 0, '[]', 0, 5000, 'failed')`,
        [refundId, sessionId, cycleId, contractId, paymentId]
      );
      await client.query(
        `insert into app_db.helper_recoveries (id, recovery_key, helper_user_id, contract_id, session_id, amount_cents)
         values ($1::uuid, $1::text, $2, $3::uuid, $4::uuid, 4212)`,
        [recoveryId, helper, contractId, sessionId]
      );
      await client.query(
        `insert into app_db.billing_ledger_entries (contract_id, cycle_id, session_id, entry_key, kind, party, amount_cents, label)
         values ($1::uuid, $2::uuid, $3::uuid, $4, 'platform_absorbed', 'platform', 120, 'refunded above the decided outcome')`,
        [contractId, cycleId, sessionId, `absorbed:${refundId}`]
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* AccountingRepo;
        yield* repo.appendMark({
          entity: OBLIGATION_AUDIT_ENTITY,
          entityId: `family_refund:${refundId}`,
          action: 'reconciled',
          actorUserId: family,
          note: 'matched to the bank statement'
        });
        return yield* repo.listSources();
      }).pipe(Effect.provide(AccountingRepoDefault))
    );
    expect(result.refunds.some((row) => row.id === refundId)).toBe(true);
    expect(result.recoveries.some((row) => row.id === recoveryId)).toBe(true);
    expect(result.absorbed.some((row) => row.entryKey === `absorbed:${refundId}`)).toBe(true);
    expect(result.contracts.find((row) => row.id === contractId)).toEqual({
      id: contractId,
      familyUserId: family,
      providerUserId: helper
    });
    expect(result.sessions.find((row) => row.id === sessionId)?.serviceName).toBe('Babysitting');
    expect(result.users.map((row) => row.name)).toEqual(
      expect.arrayContaining(['Fiona Family', 'Hana Helper'])
    );
    expect(result.marks.at(-1)).toMatchObject({
      entityId: `family_refund:${refundId}`,
      action: 'reconciled'
    });
  });
});
