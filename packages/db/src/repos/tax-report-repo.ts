import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { contractCycle, payment, type PaymentTaxLine } from '../schema';

/**
 * Where the "tax collected" report reads from: the tax lines FROZEN on what
 * was actually charged, never the current configuration.
 *
 *   - one-off payments (background checks): captured payments, their lines;
 *   - contract billing: captured cycles, whose lines carry every supply of
 *     the cycle (service value, family fee, helper commission). The cycle's
 *     payment row repeats the family-side lines, so contract payments are not
 *     read here — nothing is counted twice.
 *
 * Refunded charges are left out: their tax was given back.
 */

export type TaxCollectedSource = {
  source: 'payment' | 'contract_cycle';
  id: string;
  capturedAt: Date;
  taxLines: ReadonlyArray<PaymentTaxLine>;
};

export class TaxReportRepo extends Context.Tag('@repo/db/TaxReportRepo')<
  TaxReportRepo,
  {
    /** Charges captured in `[from, to)`. */
    listCollected: (range: {
      from: Date;
      to: Date;
    }) => Effect.Effect<Array<TaxCollectedSource>, SqlError>;
  }
>() {}

export const TaxReportRepoLive = Layer.effect(
  TaxReportRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    return {
      listCollected: ({ from, to }) =>
        Effect.all(
          [
            db
              .select({ id: payment.id, capturedAt: payment.capturedAt, taxLines: payment.taxLines })
              .from(payment)
              .where(
                and(
                  eq(payment.status, 'captured'),
                  ne(payment.kind, 'contract_cycle'),
                  gte(payment.capturedAt, from),
                  lt(payment.capturedAt, to)
                )
              ),
            db
              .select({
                id: contractCycle.id,
                capturedAt: contractCycle.capturedAt,
                taxLines: contractCycle.taxLines
              })
              .from(contractCycle)
              .where(
                and(
                  eq(contractCycle.status, 'captured'),
                  gte(contractCycle.capturedAt, from),
                  lt(contractCycle.capturedAt, to)
                )
              )
          ],
          { concurrency: 'unbounded' }
        ).pipe(
          Effect.map(([payments, cycles]) => [
            ...payments.map((row) => ({
              source: 'payment' as const,
              id: row.id,
              capturedAt: row.capturedAt!,
              taxLines: row.taxLines
            })),
            ...cycles.map((row) => ({
              source: 'contract_cycle' as const,
              id: row.id,
              capturedAt: row.capturedAt!,
              taxLines: row.taxLines
            }))
          ])
        )
    };
  })
);

export const TaxReportRepoDefault = TaxReportRepoLive.pipe(Layer.provide(DrizzleLive));

/** In-memory stand-in: filters the given sources by capture date. */
export const makeInMemoryTaxReportRepo = (sources: ReadonlyArray<TaxCollectedSource> = []) =>
  Layer.succeed(TaxReportRepo, {
    listCollected: ({ from, to }) =>
      Effect.sync(() =>
        sources.filter((row) => row.capturedAt >= from && row.capturedAt < to)
      )
  });

export const makeTaxReportRepoTest = (
  implementation: Partial<Context.Tag.Service<TaxReportRepo>>
) => Layer.succeed(TaxReportRepo, { listCollected: () => Effect.succeed([]), ...implementation });
