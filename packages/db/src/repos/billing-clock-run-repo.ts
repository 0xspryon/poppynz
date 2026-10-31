import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { billingClockRun, type BillingClockRunStatus } from '../schema';

/**
 * Staging UAT: the audit of the admin billing fast-forward
 * (`billing_clock_runs`). `start` claims the contract — at most one run per
 * contract is `running` (partial unique index) — after abandoning a run
 * left `running` since before `staleBefore` (a process that died mid-run).
 */
export type BillingClockRun = InferSelectModel<typeof billingClockRun>;

export type BillingClockRunStart = {
  contractId: string;
  actorUserId: string;
  targetAt: Date;
  eventKind: string | null;
  eventLabel: string | null;
  eventCycleNumber: number | null;
  eventDate: string | null;
  billingStatusBefore: string;
  startedAt: Date;
  staleBefore: Date;
};

export type BillingClockRunFinish = {
  status: Exclude<BillingClockRunStatus, 'running'>;
  billingStatusAfter: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  finishedAt: Date;
};

export class BillingClockRunRepo extends Context.Tag('@repo/db/BillingClockRunRepo')<
  BillingClockRunRepo,
  {
    /** The new `running` row, or null while another run of the contract is. */
    start: (input: BillingClockRunStart) => Effect.Effect<BillingClockRun | null, SqlError>;
    /** Closes a running run; null when it isn't running any more. */
    finish: (
      id: string,
      set: BillingClockRunFinish
    ) => Effect.Effect<BillingClockRun | null, SqlError>;
    /** The latest runs, newest first (of one contract when given). */
    listRecent: (filter: {
      contractId?: string;
      limit: number;
    }) => Effect.Effect<Array<BillingClockRun>, SqlError>;
  }
>() {}

export const BillingClockRunRepoLive = Layer.effect(
  BillingClockRunRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    return {
      start: (input) =>
        Effect.gen(function* () {
          yield* db
            .update(billingClockRun)
            .set({
              status: 'failed',
              error: 'abandoned (still running)',
              finishedAt: input.startedAt
            })
            .where(
              and(
                eq(billingClockRun.contractId, input.contractId),
                eq(billingClockRun.status, 'running'),
                lt(billingClockRun.startedAt, input.staleBefore)
              )
            );
          const rows = yield* db
            .insert(billingClockRun)
            .values({
              contractId: input.contractId,
              actorUserId: input.actorUserId,
              targetAt: input.targetAt,
              eventKind: input.eventKind,
              eventLabel: input.eventLabel,
              eventCycleNumber: input.eventCycleNumber,
              eventDate: input.eventDate,
              billingStatusBefore: input.billingStatusBefore,
              startedAt: input.startedAt,
              status: 'running'
            })
            .onConflictDoNothing()
            .returning();
          return rows[0] ?? null;
        }),
      finish: (id, set) =>
        db
          .update(billingClockRun)
          .set(set)
          .where(and(eq(billingClockRun.id, id), eq(billingClockRun.status, 'running')))
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      listRecent: (filter) =>
        db
          .select()
          .from(billingClockRun)
          .where(filter.contractId ? eq(billingClockRun.contractId, filter.contractId) : undefined)
          .orderBy(desc(billingClockRun.startedAt))
          .limit(filter.limit)
    };
  })
);

export const BillingClockRunRepoDefault = BillingClockRunRepoLive.pipe(Layer.provide(DrizzleLive));

/** TEST SUPPORT: the same rules over an array (one running run per contract). */
export const makeInMemoryBillingClockRunRepo = (initial: ReadonlyArray<BillingClockRun> = []) => {
  const state = { runs: initial.map((run) => ({ ...run })) };
  let sequence = 0;
  const service: Context.Tag.Service<typeof BillingClockRunRepo> = {
    start: (input) =>
      Effect.sync(() => {
        for (const run of state.runs) {
          if (
            run.contractId === input.contractId &&
            run.status === 'running' &&
            run.startedAt < input.staleBefore
          ) {
            Object.assign(run, {
              status: 'failed',
              error: 'abandoned (still running)',
              finishedAt: input.startedAt
            });
          }
        }
        if (
          state.runs.some((run) => run.contractId === input.contractId && run.status === 'running')
        ) {
          return null;
        }
        sequence += 1;
        const run: BillingClockRun = {
          id: `clock-run-${sequence}`,
          contractId: input.contractId,
          actorUserId: input.actorUserId,
          targetAt: input.targetAt,
          eventKind: input.eventKind,
          eventLabel: input.eventLabel,
          eventCycleNumber: input.eventCycleNumber,
          eventDate: input.eventDate,
          status: 'running',
          billingStatusBefore: input.billingStatusBefore,
          billingStatusAfter: null,
          summary: null,
          error: null,
          startedAt: input.startedAt,
          finishedAt: null,
          createdAt: input.startedAt
        };
        state.runs.push(run);
        return { ...run };
      }),
    finish: (id, set) =>
      Effect.sync(() => {
        const run = state.runs.find((row) => row.id === id && row.status === 'running');
        if (!run) return null;
        Object.assign(run, set);
        return { ...run };
      }),
    listRecent: (filter) =>
      Effect.sync(() =>
        state.runs
          .filter((run) => !filter.contractId || run.contractId === filter.contractId)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
          .slice(0, filter.limit)
          .map((run) => ({ ...run }))
      )
  };
  return { state, service, layer: Layer.succeed(BillingClockRunRepo, service) };
};
