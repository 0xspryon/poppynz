import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { and, asc, desc, eq, isNull, type InferSelectModel } from 'drizzle-orm';
import { Context, Data, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import {
  defaultTaxJurisdictions,
  defaultTaxRates,
  defaultTaxRegistrations,
  defaultTaxSupplyTypes,
  defaultTaxTreatments
} from '../tax-defaults';
import {
  taxConfigAudit,
  taxJurisdiction,
  taxRate,
  taxRegistration,
  taxSupplyTreatment,
  taxSupplyType
} from '../schema';

/**
 * Sales-tax configuration (piece 3, spec §3a). The read methods feed quote
 * time (`liveConfig`) and a future accountant portal (the lists, the audit);
 * the write methods are the only way rows change:
 *
 *   - `supersede…` makes a new value effective from a date: the row in force
 *     on that date is closed there (or, when it starts that same day, soft-
 *     deleted as replaced), the new row is inserted, and each step appends an
 *     audit row — all in one transaction. A live row starting AFTER the date
 *     is never rewritten: that is a `TaxConfigOverlapError` (delete it first).
 *   - `delete…` soft-deletes one row (audited).
 *
 * The EXCLUDE constraints in 0027_tax_config back the overlap rule up.
 */

export type TaxJurisdiction = InferSelectModel<typeof taxJurisdiction>;
export type TaxRate = InferSelectModel<typeof taxRate>;
export type TaxSupplyType = InferSelectModel<typeof taxSupplyType>;
export type TaxSupplyTreatment = InferSelectModel<typeof taxSupplyTreatment>;
export type TaxRegistration = InferSelectModel<typeof taxRegistration>;
export type TaxConfigAudit = InferSelectModel<typeof taxConfigAudit>;
export type TaxComponentValue = TaxRate['component'];

export type TaxConfigEntity = 'tax_rate' | 'tax_supply_treatment' | 'tax_registration';

/** Who changed the configuration and why. `actorUserId` is null for seeds and
 * system changes. */
export type TaxConfigActor = { actorUserId: string | null; reason: string };

export type TaxRateInput = Pick<
  TaxRate,
  'jurisdictionCode' | 'component' | 'rateMillipercent' | 'effectiveFrom'
> & { effectiveTo?: string | null };

export type TaxSupplyTreatmentInput = Pick<
  TaxSupplyTreatment,
  'supplyTypeCode' | 'treatment' | 'components' | 'placeOfSupply' | 'effectiveFrom'
> & { effectiveTo?: string | null };

export type TaxRegistrationInput = Pick<
  TaxRegistration,
  | 'jurisdictionCode'
  | 'program'
  | 'components'
  | 'registrationNumber'
  | 'registered'
  | 'isPlaceholder'
  | 'effectiveFrom'
> & { effectiveTo?: string | null };

/** The live rows, history included — the resolver picks what is in force. */
export type TaxLiveConfig = {
  rates: Array<TaxRate>;
  treatments: Array<TaxSupplyTreatment>;
  registrations: Array<TaxRegistration>;
};

export class TaxConfigOverlapError extends Data.TaggedError('TaxConfigOverlapError')<{
  entity: TaxConfigEntity;
  /** The live row that would overlap, when known. */
  conflictingId: string | null;
}> {}

export class TaxConfigNotFoundError extends Data.TaggedError('TaxConfigNotFoundError')<{
  entity: TaxConfigEntity;
  id: string;
}> {}

type Dated = { id: string; effectiveFrom: string; effectiveTo: string | null };

export type SupersedePlan =
  | { kind: 'overlap'; conflictingId: string }
  | {
      kind: 'ok';
      /** Live rows starting on the new date: replaced (soft-deleted). */
      replace: Array<string>;
      /** The row in force on the new date: closed there. */
      close: Array<string>;
    };

/** Pure: what superseding the live rows of one key from `from` (until `to`)
 * does. Shared by the live and in-memory repos so both behave alike. */
export const planSupersede = (
  live: ReadonlyArray<Dated>,
  from: string,
  to: string | null = null
): SupersedePlan => {
  const later = live.find(
    (row) => row.effectiveFrom > from && (to === null || row.effectiveFrom < to)
  );
  if (later) return { kind: 'overlap', conflictingId: later.id };
  const replace = live.filter((row) => row.effectiveFrom === from).map((row) => row.id);
  const close = live
    .filter(
      (row) => row.effectiveFrom < from && (row.effectiveTo === null || row.effectiveTo > from)
    )
    .map((row) => row.id);
  return { kind: 'ok', replace, close };
};

export class TaxConfigRepo extends Context.Tag('@repo/db/TaxConfigRepo')<
  TaxConfigRepo,
  {
    listJurisdictions: () => Effect.Effect<Array<TaxJurisdiction>, SqlError>;
    listSupplyTypes: () => Effect.Effect<Array<TaxSupplyType>, SqlError>;
    /** Live rows; `includeDeleted` adds soft-deleted ones (history views). */
    listRates: (options?: { includeDeleted?: boolean }) => Effect.Effect<Array<TaxRate>, SqlError>;
    listSupplyTreatments: (options?: {
      includeDeleted?: boolean;
    }) => Effect.Effect<Array<TaxSupplyTreatment>, SqlError>;
    listRegistrations: (options?: {
      includeDeleted?: boolean;
    }) => Effect.Effect<Array<TaxRegistration>, SqlError>;
    /** Everything quote time needs, in one call. */
    liveConfig: () => Effect.Effect<TaxLiveConfig, SqlError>;
    listAudit: (filter?: {
      entity?: TaxConfigEntity;
      recordId?: string;
      limit?: number;
    }) => Effect.Effect<Array<TaxConfigAudit>, SqlError>;
    supersedeRate: (
      input: TaxRateInput,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxRate, SqlError | TaxConfigOverlapError>;
    deleteRate: (
      id: string,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxRate, SqlError | TaxConfigNotFoundError>;
    supersedeSupplyTreatment: (
      input: TaxSupplyTreatmentInput,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxSupplyTreatment, SqlError | TaxConfigOverlapError>;
    deleteSupplyTreatment: (
      id: string,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxSupplyTreatment, SqlError | TaxConfigNotFoundError>;
    supersedeRegistration: (
      input: TaxRegistrationInput,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxRegistration, SqlError | TaxConfigOverlapError>;
    deleteRegistration: (
      id: string,
      actor: TaxConfigActor
    ) => Effect.Effect<TaxRegistration, SqlError | TaxConfigNotFoundError>;
  }
>() {}

/** Postgres exclusion violation (SQLSTATE 23P01), possibly nested. */
const isExclusionViolation = (error: SqlError): boolean => {
  let current: unknown = error.cause;
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    if ((current as { code?: unknown }).code === '23P01') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

const json = (row: unknown) => JSON.parse(JSON.stringify(row)) as unknown;

export const TaxConfigRepoLive = Layer.effect(
  TaxConfigRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const audit = (
      entity: TaxConfigEntity,
      recordId: string,
      action: TaxConfigAudit['action'],
      actor: TaxConfigActor,
      before: unknown,
      after: unknown
    ) =>
      db.insert(taxConfigAudit).values({
        entity,
        recordId,
        action,
        actorUserId: actor.actorUserId,
        reason: actor.reason,
        before: before === null ? null : json(before),
        after: after === null ? null : json(after)
      });

    // One generic supersede/delete over the three effective-dated tables.
    // `table` is typed loosely on purpose: the three share the columns used.
    const makeOps = <Row extends Dated & { deletedAt: Date | null }>(
      entity: TaxConfigEntity,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      table: any,
      keyWhere: (input: Record<string, unknown>) => unknown
    ) => {
      const supersede = (
        input: Record<string, unknown> & { effectiveFrom: string; effectiveTo?: string | null },
        actor: TaxConfigActor
      ): Effect.Effect<Row, SqlError | TaxConfigOverlapError> =>
        sqlClient
          .withTransaction(
            // The table is typed loosely (`any`), so the body's type is pinned here.
            Effect.gen(function* () {
              const live = (yield* db
                .select()
                .from(table)
                .where(and(keyWhere(input) as never, isNull(table.deletedAt)))
                .for('update')) as Array<Row>;
              const plan = planSupersede(live, input.effectiveFrom, input.effectiveTo ?? null);
              if (plan.kind === 'overlap') {
                return yield* Effect.fail(
                  new TaxConfigOverlapError({ entity, conflictingId: plan.conflictingId })
                );
              }
              for (const id of plan.replace) {
                const before = live.find((row) => row.id === id)!;
                const rows = (yield* db
                  .update(table)
                  .set({ deletedAt: new Date() })
                  .where(eq(table.id, id))
                  .returning()) as Array<Row>;
                yield* audit(entity, id, 'delete', actor, before, rows[0] ?? null);
              }
              for (const id of plan.close) {
                const before = live.find((row) => row.id === id)!;
                const rows = (yield* db
                  .update(table)
                  .set({ effectiveTo: input.effectiveFrom })
                  .where(eq(table.id, id))
                  .returning()) as Array<Row>;
                yield* audit(entity, id, 'close', actor, before, rows[0] ?? null);
              }
              const inserted = (yield* db
                .insert(table)
                .values({ ...input, effectiveTo: input.effectiveTo ?? null })
                .returning()) as Array<Row>;
              const row = inserted[0]!;
              yield* audit(entity, row.id, 'create', actor, null, row);
              return row;
            }) as never as Effect.Effect<Row, SqlError | TaxConfigOverlapError>
          )
          .pipe(
            Effect.catchTag(
              'SqlError',
              (error): Effect.Effect<never, SqlError | TaxConfigOverlapError> =>
                isExclusionViolation(error)
                  ? Effect.fail(new TaxConfigOverlapError({ entity, conflictingId: null }))
                  : Effect.fail(error)
            )
          );

      const remove = (
        id: string,
        actor: TaxConfigActor
      ): Effect.Effect<Row, SqlError | TaxConfigNotFoundError> =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            const before = (yield* db
              .select()
              .from(table)
              .where(and(eq(table.id, id), isNull(table.deletedAt)))
              .for('update')) as Array<Row>;
            if (!before[0]) {
              return yield* Effect.fail(new TaxConfigNotFoundError({ entity, id }));
            }
            const rows = (yield* db
              .update(table)
              .set({ deletedAt: new Date() })
              .where(eq(table.id, id))
              .returning()) as Array<Row>;
            yield* audit(entity, id, 'delete', actor, before[0], rows[0]);
            return rows[0]!;
          }) as never as Effect.Effect<Row, SqlError | TaxConfigNotFoundError>
        );

      const list = (options?: { includeDeleted?: boolean }) =>
        db
          .select()
          .from(table)
          .where(options?.includeDeleted ? undefined : isNull(table.deletedAt))
          .orderBy(asc(table.effectiveFrom)) as unknown as Effect.Effect<Array<Row>, SqlError>;

      return { supersede, remove, list };
    };

    const rates = makeOps<TaxRate>('tax_rate', taxRate, (input) =>
      and(
        eq(taxRate.jurisdictionCode, input.jurisdictionCode as string),
        eq(taxRate.component, input.component as TaxComponentValue)
      )
    );
    const treatments = makeOps<TaxSupplyTreatment>(
      'tax_supply_treatment',
      taxSupplyTreatment,
      (input) => eq(taxSupplyTreatment.supplyTypeCode, input.supplyTypeCode as string)
    );
    const registrations = makeOps<TaxRegistration>('tax_registration', taxRegistration, (input) =>
      and(
        eq(taxRegistration.jurisdictionCode, input.jurisdictionCode as string),
        eq(taxRegistration.program, input.program as string)
      )
    );

    return {
      listJurisdictions: () => db.select().from(taxJurisdiction).orderBy(asc(taxJurisdiction.code)),
      listSupplyTypes: () => db.select().from(taxSupplyType).orderBy(asc(taxSupplyType.code)),
      listRates: rates.list,
      listSupplyTreatments: treatments.list,
      listRegistrations: registrations.list,
      liveConfig: () =>
        Effect.all({
          rates: rates.list(),
          treatments: treatments.list(),
          registrations: registrations.list()
        }),
      listAudit: (filter = {}) =>
        db
          .select()
          .from(taxConfigAudit)
          .where(
            and(
              filter.entity ? eq(taxConfigAudit.entity, filter.entity) : undefined,
              filter.recordId ? eq(taxConfigAudit.recordId, filter.recordId) : undefined
            )
          )
          .orderBy(desc(taxConfigAudit.createdAt))
          .limit(filter.limit ?? 200),
      supersedeRate: (input, actor) => rates.supersede(input, actor),
      deleteRate: rates.remove,
      supersedeSupplyTreatment: (input, actor) => treatments.supersede(input, actor),
      deleteSupplyTreatment: treatments.remove,
      supersedeRegistration: (input, actor) => registrations.supersede(input, actor),
      deleteRegistration: registrations.remove
    };
  })
);

export const TaxConfigRepoDefault = TaxConfigRepoLive.pipe(Layer.provide(DrizzleLive));

// ---------------------------------------------------------------------------
// In-memory stand-in with the live repo's semantics, for unit tests.

let memoryId = 0;
const nextId = () => `tax-${++memoryId}`;

export const makeInMemoryTaxConfigRepo = (
  initial: Partial<TaxLiveConfig> & {
    jurisdictions?: Array<TaxJurisdiction>;
    supplyTypes?: Array<TaxSupplyType>;
  } = {}
) => {
  const state = {
    jurisdictions: [...(initial.jurisdictions ?? [])],
    supplyTypes: [...(initial.supplyTypes ?? [])],
    rates: [...(initial.rates ?? [])],
    treatments: [...(initial.treatments ?? [])],
    registrations: [...(initial.registrations ?? [])],
    audit: [] as Array<TaxConfigAudit>
  };
  const now = () => new Date();
  const record = (
    entity: TaxConfigEntity,
    recordId: string,
    action: TaxConfigAudit['action'],
    actor: TaxConfigActor,
    before: unknown,
    after: unknown
  ) =>
    state.audit.push({
      id: nextId(),
      entity,
      recordId,
      action,
      actorUserId: actor.actorUserId,
      reason: actor.reason,
      before: before ?? null,
      after: after ?? null,
      createdAt: now()
    });

  const ops = <Row extends Dated & { deletedAt: Date | null; createdAt: Date }>(
    entity: TaxConfigEntity,
    rows: Array<Row>,
    sameKey: (row: Row, input: Record<string, unknown>) => boolean
  ) => ({
    supersede: (
      input: Record<string, unknown> & { effectiveFrom: string; effectiveTo?: string | null },
      actor: TaxConfigActor
    ): Effect.Effect<Row, TaxConfigOverlapError> =>
      Effect.suspend(() => {
        const live = rows.filter((row) => row.deletedAt === null && sameKey(row, input));
        const plan = planSupersede(live, input.effectiveFrom, input.effectiveTo ?? null);
        if (plan.kind === 'overlap') {
          return Effect.fail(
            new TaxConfigOverlapError({ entity, conflictingId: plan.conflictingId })
          );
        }
        for (const id of plan.replace) {
          const index = rows.findIndex((row) => row.id === id);
          const before = rows[index]!;
          rows[index] = { ...before, deletedAt: now() };
          record(entity, id, 'delete', actor, before, rows[index]);
        }
        for (const id of plan.close) {
          const index = rows.findIndex((row) => row.id === id);
          const before = rows[index]!;
          rows[index] = { ...before, effectiveTo: input.effectiveFrom };
          record(entity, id, 'close', actor, before, rows[index]);
        }
        const row = {
          ...input,
          id: nextId(),
          effectiveTo: input.effectiveTo ?? null,
          deletedAt: null,
          createdAt: now()
        } as unknown as Row;
        rows.push(row);
        record(entity, row.id, 'create', actor, null, row);
        return Effect.succeed(row);
      }),
    remove: (id: string, actor: TaxConfigActor): Effect.Effect<Row, TaxConfigNotFoundError> =>
      Effect.suspend(() => {
        const index = rows.findIndex((row) => row.id === id && row.deletedAt === null);
        if (index < 0) return Effect.fail(new TaxConfigNotFoundError({ entity, id }));
        const before = rows[index]!;
        rows[index] = { ...before, deletedAt: now() };
        record(entity, id, 'delete', actor, before, rows[index]);
        return Effect.succeed(rows[index]!);
      }),
    list: (options?: { includeDeleted?: boolean }) =>
      Effect.sync(() =>
        rows
          .filter((row) => options?.includeDeleted || row.deletedAt === null)
          .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      )
  });

  const rates = ops<TaxRate>(
    'tax_rate',
    state.rates,
    (row, input) =>
      row.jurisdictionCode === input.jurisdictionCode && row.component === input.component
  );
  const treatments = ops<TaxSupplyTreatment>(
    'tax_supply_treatment',
    state.treatments,
    (row, input) => row.supplyTypeCode === input.supplyTypeCode
  );
  const registrations = ops<TaxRegistration>(
    'tax_registration',
    state.registrations,
    (row, input) => row.jurisdictionCode === input.jurisdictionCode && row.program === input.program
  );

  const service: Context.Tag.Service<TaxConfigRepo> = {
    listJurisdictions: () => Effect.sync(() => [...state.jurisdictions]),
    listSupplyTypes: () => Effect.sync(() => [...state.supplyTypes]),
    listRates: rates.list,
    listSupplyTreatments: treatments.list,
    listRegistrations: registrations.list,
    liveConfig: () =>
      Effect.all({
        rates: rates.list(),
        treatments: treatments.list(),
        registrations: registrations.list()
      }),
    listAudit: (filter = {}) =>
      Effect.sync(() =>
        state.audit
          .filter(
            (row) =>
              (!filter.entity || row.entity === filter.entity) &&
              (!filter.recordId || row.recordId === filter.recordId)
          )
          .reverse()
          .slice(0, filter.limit ?? 200)
      ),
    supersedeRate: (input, actor) => rates.supersede(input, actor),
    deleteRate: rates.remove,
    supersedeSupplyTreatment: (input, actor) => treatments.supersede(input, actor),
    deleteSupplyTreatment: treatments.remove,
    supersedeRegistration: (input, actor) => registrations.supersede(input, actor),
    deleteRegistration: registrations.remove
  };
  return { layer: Layer.succeed(TaxConfigRepo, service), state };
};

/** Fixture rows for tests. */
export const dummyTaxRate = (overrides: Partial<TaxRate> = {}): TaxRate => ({
  id: nextId(),
  jurisdictionCode: 'ON',
  component: 'hst',
  rateMillipercent: 13000,
  effectiveFrom: '2010-07-01',
  effectiveTo: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides
});

export const dummyTaxSupplyTreatment = (
  overrides: Partial<TaxSupplyTreatment> = {}
): TaxSupplyTreatment => ({
  id: nextId(),
  supplyTypeCode: 'family_service_fee',
  treatment: 'taxable',
  components: ['gst', 'hst', 'qst'],
  placeOfSupply: 'contract_location',
  effectiveFrom: '2008-01-01',
  effectiveTo: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides
});

export const dummyTaxRegistration = (
  overrides: Partial<TaxRegistration> = {}
): TaxRegistration => ({
  id: nextId(),
  jurisdictionCode: 'CA',
  program: 'gst_hst',
  components: ['gst', 'hst'],
  registrationNumber: 'PLACEHOLDER-000000000RT0001',
  registered: true,
  isPlaceholder: true,
  effectiveFrom: '2008-01-01',
  effectiveTo: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides
});

/** The seeded default configuration (seed 0004_tax_config) as an in-memory
 * repo — the realistic fixture for quote tests. `adjust` edits the rows
 * before the repo is built (e.g. switch a registration off). */
export const makeSeededTaxConfigRepo = (
  adjust: (config: TaxLiveConfig) => TaxLiveConfig = (config) => config
) => {
  const created = new Date('2026-01-01T00:00:00.000Z');
  const base: TaxLiveConfig = {
    rates: defaultTaxRates.map((row) =>
      dummyTaxRate({ ...row, effectiveTo: row.effectiveTo ?? null, createdAt: created })
    ),
    treatments: defaultTaxTreatments.map((row) =>
      dummyTaxSupplyTreatment({ ...row, effectiveTo: row.effectiveTo ?? null, createdAt: created })
    ),
    registrations: defaultTaxRegistrations.map((row) =>
      dummyTaxRegistration({
        ...row,
        registrationNumber: row.registrationNumber ?? null,
        isPlaceholder: row.isPlaceholder ?? false,
        effectiveTo: row.effectiveTo ?? null,
        createdAt: created
      })
    )
  };
  return makeInMemoryTaxConfigRepo({
    ...adjust(base),
    jurisdictions: defaultTaxJurisdictions.map((row) => ({ ...row }) as TaxJurisdiction),
    supplyTypes: defaultTaxSupplyTypes.map((row) => ({ ...row }) as TaxSupplyType)
  });
};
