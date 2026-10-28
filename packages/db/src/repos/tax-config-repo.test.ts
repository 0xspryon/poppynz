import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import { beforeAll, describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { DrizzleLive } from '../effect-db';
import { taxJurisdiction } from '../schema';
import { defaultTaxJurisdictions } from '../tax-defaults';
import {
  dummyTaxRate,
  makeInMemoryTaxConfigRepo,
  planSupersede,
  TaxConfigRepo,
  TaxConfigRepoDefault
} from './tax-config-repo';

const actor = { actorUserId: null, reason: 'test' };

describe('planSupersede', () => {
  const live = [
    { id: 'a', effectiveFrom: '2010-07-01', effectiveTo: '2025-04-01' },
    { id: 'b', effectiveFrom: '2025-04-01', effectiveTo: null }
  ];

  it('closes the row in force on the new date', () => {
    expect(planSupersede(live, '2027-01-01')).toEqual({ kind: 'ok', replace: [], close: ['b'] });
  });

  it('replaces a row starting on the same date', () => {
    expect(planSupersede(live, '2025-04-01')).toEqual({ kind: 'ok', replace: ['b'], close: [] });
  });

  it('refuses to rewrite a row that starts later', () => {
    expect(planSupersede(live, '2020-01-01')).toEqual({ kind: 'overlap', conflictingId: 'b' });
  });

  it('allows a bounded row that ends before the next one', () => {
    expect(planSupersede([live[1]!], '2024-01-01', '2025-04-01')).toEqual({
      kind: 'ok',
      replace: [],
      close: []
    });
  });
});

describe('makeInMemoryTaxConfigRepo', () => {
  it('supersedes a rate: closes the old row, inserts the new one, audits both', async () => {
    const { layer, state } = makeInMemoryTaxConfigRepo({
      rates: [dummyTaxRate({ id: 'on-13', effectiveFrom: '2010-07-01' })]
    });
    const result = await Effect.runPromise(
      TaxConfigRepo.pipe(
        Effect.flatMap((repo) =>
          repo.supersedeRate(
            {
              jurisdictionCode: 'ON',
              component: 'hst',
              rateMillipercent: 12000,
              effectiveFrom: '2027-01-01'
            },
            { actorUserId: 'accountant-1', reason: 'rate change' }
          )
        ),
        Effect.provide(layer)
      )
    );
    expect(result).toMatchObject({
      rateMillipercent: 12000,
      effectiveFrom: '2027-01-01',
      effectiveTo: null
    });
    expect(state.rates.find((row) => row.id === 'on-13')?.effectiveTo).toBe('2027-01-01');
    expect(state.audit.map((row) => [row.action, row.actorUserId, row.reason])).toEqual([
      ['close', 'accountant-1', 'rate change'],
      ['create', 'accountant-1', 'rate change']
    ]);
  });

  it('refuses an overlapping rate with a typed error and changes nothing', async () => {
    const { layer, state } = makeInMemoryTaxConfigRepo({
      rates: [dummyTaxRate({ id: 'on-13', effectiveFrom: '2026-01-01' })]
    });
    const exit = await Effect.runPromiseExit(
      TaxConfigRepo.pipe(
        Effect.flatMap((repo) =>
          repo.supersedeRate(
            {
              jurisdictionCode: 'ON',
              component: 'hst',
              rateMillipercent: 15000,
              effectiveFrom: '2025-01-01'
            },
            actor
          )
        ),
        Effect.provide(layer)
      )
    );
    expect(exit._tag).toBe('Failure');
    expect(JSON.stringify(exit)).toContain('TaxConfigOverlapError');
    expect(state.rates).toHaveLength(1);
    expect(state.audit).toHaveLength(0);
  });

  it('soft-deletes and audits; a second delete is not found', async () => {
    const { layer, state } = makeInMemoryTaxConfigRepo({ rates: [dummyTaxRate({ id: 'r1' })] });
    const run = <A, E>(effect: (repo: typeof TaxConfigRepo.Service) => Effect.Effect<A, E>) =>
      Effect.runPromiseExit(TaxConfigRepo.pipe(Effect.flatMap(effect), Effect.provide(layer)));
    const first = await run((repo) => repo.deleteRate('r1', actor));
    expect(first._tag).toBe('Success');
    expect(state.rates[0]?.deletedAt).not.toBeNull();
    const live = await run((repo) => repo.listRates());
    expect(live._tag === 'Success' && live.value).toEqual([]);
    const history = await run((repo) => repo.listRates({ includeDeleted: true }));
    expect(history._tag === 'Success' && history.value).toHaveLength(1);
    const second = await run((repo) => repo.deleteRate('r1', actor));
    expect(JSON.stringify(second)).toContain('TaxConfigNotFoundError');
    expect(state.audit.map((row) => row.action)).toEqual(['delete']);
  });
});

// Against a real Postgres with migrations applied (0027_tax_config): run with
// TAX_REPO_TEST_DATABASE_URL=postgres://… bun test. Each test writes under a
// throwaway, never-registered program and soft-deletes it afterwards (the
// audit trail is append-only by design), so point it at a dev database only.
// The jurisdictions are reference data that seed 0004 inserts, not a
// migration: a freshly migrated, unseeded database gets them here first
// (left alone where they already exist).
const liveUrl = process.env.TAX_REPO_TEST_DATABASE_URL;
describe.skipIf(!liveUrl)('TaxConfigRepoLive (Postgres)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = liveUrl;
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* PgDrizzle.PgDrizzle;
        yield* db
          .insert(taxJurisdiction)
          .values([...defaultTaxJurisdictions])
          .onConflictDoNothing();
      }).pipe(Effect.provide(DrizzleLive))
    );
  });
  const run = <A, E>(effect: (repo: typeof TaxConfigRepo.Service) => Effect.Effect<A, E>) => {
    process.env.DATABASE_URL = liveUrl;
    return Effect.runPromiseExit(
      TaxConfigRepo.pipe(Effect.flatMap(effect), Effect.provide(TaxConfigRepoDefault))
    );
  };
  const program = `test-${Date.now()}`;

  it('supersedes inside a transaction and the exclusion constraint backs the overlap rule', async () => {
    const first = await run((repo) =>
      repo.supersedeRegistration(
        {
          jurisdictionCode: 'CA',
          program,
          components: ['gst'],
          registrationNumber: 'T-1',
          registered: false,
          isPlaceholder: true,
          effectiveFrom: '2020-01-01'
        },
        actor
      )
    );
    expect(first._tag).toBe('Success');
    const second = await run((repo) =>
      repo.supersedeRegistration(
        {
          jurisdictionCode: 'CA',
          program,
          components: ['gst'],
          registrationNumber: 'T-2',
          registered: false,
          isPlaceholder: false,
          effectiveFrom: '2026-01-01'
        },
        actor
      )
    );
    expect(second._tag).toBe('Success');
    const rows = await run((repo) => repo.listRegistrations());
    const mine = rows._tag === 'Success' ? rows.value.filter((row) => row.program === program) : [];
    expect(mine.map((row) => [row.registrationNumber, row.effectiveFrom, row.effectiveTo])).toEqual(
      [
        ['T-1', '2020-01-01', '2026-01-01'],
        ['T-2', '2026-01-01', null]
      ]
    );
    const overlap = await run((repo) =>
      repo.supersedeRegistration(
        {
          jurisdictionCode: 'CA',
          program,
          components: ['gst'],
          registrationNumber: 'T-3',
          registered: false,
          isPlaceholder: false,
          effectiveFrom: '2025-01-01'
        },
        actor
      )
    );
    expect(JSON.stringify(overlap)).toContain('TaxConfigOverlapError');
    const audit = await run((repo) => repo.listAudit({ entity: 'tax_registration' }));
    expect(audit._tag === 'Success' && audit.value.length).toBeGreaterThanOrEqual(3);
    // Leave nothing live behind (unregistered throwaway rows, soft-deleted).
    for (const row of mine) {
      await run((repo) => repo.deleteRegistration(row.id, actor));
    }
  });
});
