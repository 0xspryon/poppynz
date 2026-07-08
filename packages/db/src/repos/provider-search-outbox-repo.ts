import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, inArray, type InferSelectModel, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { providerSearchOutbox } from "../schema";

export type ProviderSearchOutbox = InferSelectModel<typeof providerSearchOutbox>;
export type ProviderSearchOutboxStatus = ProviderSearchOutbox["status"];

export class ProviderSearchOutboxRepo extends Context.Tag("@repo/db/ProviderSearchOutboxRepo")<
  ProviderSearchOutboxRepo,
  {
    createPending: (userId: string) => Effect.Effect<ProviderSearchOutbox, SqlError>;
    listUnresolved: (limit: number) => Effect.Effect<Array<ProviderSearchOutbox>, SqlError>;
    markProcessing: (id: string) => Effect.Effect<ProviderSearchOutbox, SqlError | DBNotFoundError>;
    markProcessed: (id: string) => Effect.Effect<ProviderSearchOutbox, SqlError | DBNotFoundError>;
    markFailed: (id: string, error: string) => Effect.Effect<ProviderSearchOutbox, SqlError | DBNotFoundError>;
    markSupersededBefore: (cutoff: Date) => Effect.Effect<number, SqlError>;
  }
>() { }

const unresolvedStatuses: Array<ProviderSearchOutboxStatus> = ["pending", "processing", "failed"];

const oneOrNotFound = (id: string) => (rows: Array<ProviderSearchOutbox>) =>
  rows[0]
    ? Effect.succeed(rows[0])
    : Effect.fail(new DBNotFoundError({ entity: "providerSearchOutbox", value: id }));

export const ProviderSearchOutboxRepoLive = Layer.effect(
  ProviderSearchOutboxRepo,
  Effect.gen(function*() {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      createPending: (userId) =>
        db
          .insert(providerSearchOutbox)
          .values({ userId, status: "pending" })
          .onConflictDoUpdate({
            target: providerSearchOutbox.userId,
            targetWhere: sql`${providerSearchOutbox.status} in ('pending', 'processing', 'failed')`,
            set: { status: "pending", updatedAt: new Date() },
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      listUnresolved: (limit) =>
        db
          .select()
          .from(providerSearchOutbox)
          .where(eq(providerSearchOutbox.status, "pending"))
          .limit(limit),
      markProcessing: (id) =>
        db
          .update(providerSearchOutbox)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(providerSearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markProcessed: (id) =>
        db
          .update(providerSearchOutbox)
          .set({ status: "processed", processedAt: new Date(), updatedAt: new Date() })
          .where(eq(providerSearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markFailed: (id, error) =>
        db
          .update(providerSearchOutbox)
          .set({ status: "failed", attempts: sql`${providerSearchOutbox.attempts} + 1`, lastError: error, updatedAt: new Date() })
          .where(eq(providerSearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markSupersededBefore: (cutoff) =>
        db
          .update(providerSearchOutbox)
          .set({ status: "superseded", processedAt: new Date(), updatedAt: new Date() })
          .where(and(inArray(providerSearchOutbox.status, unresolvedStatuses), lte(providerSearchOutbox.createdAt, cutoff)))
          .returning({ id: providerSearchOutbox.id })
          .pipe(Effect.map((rows) => rows.length)),
    };
  }),
);

export const ProviderSearchOutboxRepoDefault = ProviderSearchOutboxRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeProviderSearchOutboxRepoTest = (implementation: Context.Tag.Service<ProviderSearchOutboxRepo>) =>
  Layer.succeed(ProviderSearchOutboxRepo, implementation);
