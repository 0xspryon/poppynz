import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, inArray, type InferSelectModel, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { familySearchOutbox } from "../schema";

export type FamilySearchOutbox = InferSelectModel<typeof familySearchOutbox>;
export type FamilySearchOutboxStatus = FamilySearchOutbox["status"];

export class FamilySearchOutboxRepo extends Context.Tag("@repo/db/FamilySearchOutboxRepo")<
  FamilySearchOutboxRepo,
  {
    createPending: (userId: string) => Effect.Effect<FamilySearchOutbox, SqlError>;
    listUnresolved: (limit: number) => Effect.Effect<Array<FamilySearchOutbox>, SqlError>;
    markProcessing: (id: string) => Effect.Effect<FamilySearchOutbox, SqlError | DBNotFoundError>;
    markProcessed: (id: string) => Effect.Effect<FamilySearchOutbox, SqlError | DBNotFoundError>;
    markFailed: (id: string, error: string) => Effect.Effect<FamilySearchOutbox, SqlError | DBNotFoundError>;
    markSupersededBefore: (cutoff: Date) => Effect.Effect<number, SqlError>;
  }
>() { }

const unresolvedStatuses: Array<FamilySearchOutboxStatus> = ["pending", "processing", "failed"];

const oneOrNotFound = (id: string) => (rows: Array<FamilySearchOutbox>) =>
  rows[0]
    ? Effect.succeed(rows[0])
    : Effect.fail(new DBNotFoundError({ entity: "familySearchOutbox", value: id }));

export const FamilySearchOutboxRepoLive = Layer.effect(
  FamilySearchOutboxRepo,
  Effect.gen(function*() {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      createPending: (userId) =>
        db
          .insert(familySearchOutbox)
          .values({ userId, status: "pending" })
          .onConflictDoUpdate({
            target: familySearchOutbox.userId,
            targetWhere: sql`${familySearchOutbox.status} in ('pending', 'processing', 'failed')`,
            set: { status: "pending", updatedAt: new Date() },
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      listUnresolved: (limit) =>
        // Includes rows stranded in `processing`/`failed` by a worker crash —
        // startup recovery re-enqueues them (reconcile jobs are idempotent).
        db
          .select()
          .from(familySearchOutbox)
          .where(inArray(familySearchOutbox.status, unresolvedStatuses))
          .limit(limit),
      markProcessing: (id) =>
        db
          .update(familySearchOutbox)
          .set({ status: "processing", updatedAt: new Date() })
          .where(eq(familySearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markProcessed: (id) =>
        db
          .update(familySearchOutbox)
          .set({ status: "processed", processedAt: new Date(), updatedAt: new Date() })
          .where(eq(familySearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markFailed: (id, error) =>
        db
          .update(familySearchOutbox)
          .set({ status: "failed", attempts: sql`${familySearchOutbox.attempts} + 1`, lastError: error, updatedAt: new Date() })
          .where(eq(familySearchOutbox.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      markSupersededBefore: (cutoff) =>
        db
          .update(familySearchOutbox)
          .set({ status: "superseded", processedAt: new Date(), updatedAt: new Date() })
          .where(and(inArray(familySearchOutbox.status, unresolvedStatuses), lte(familySearchOutbox.createdAt, cutoff)))
          .returning({ id: familySearchOutbox.id })
          .pipe(Effect.map((rows) => rows.length)),
    };
  }),
);

export const FamilySearchOutboxRepoDefault = FamilySearchOutboxRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeFamilySearchOutboxRepoTest = (implementation: Context.Tag.Service<FamilySearchOutboxRepo>) =>
  Layer.succeed(FamilySearchOutboxRepo, implementation);
