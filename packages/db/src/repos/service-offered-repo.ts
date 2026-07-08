import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, type InferSelectModel, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { serviceOffered } from "../schema";

export type ServiceOffered = InferSelectModel<typeof serviceOffered>;
export type ServiceOfferedCreateInput = {
  userId: string;
  name: string;
  description?: string | null;
  hourlyRateCents: number;
  currency: string;
};
export type ServiceOfferedUpdateInput = Partial<Pick<ServiceOffered, "name" | "description" | "hourlyRateCents" | "currency">>;

export class ServiceOfferedRepo extends Context.Tag("@repo/db/ServiceOfferedRepo")<
  ServiceOfferedRepo,
  {
    listByUserId: (userId: string) => Effect.Effect<Array<ServiceOffered>, SqlError>;
    create: (input: ServiceOfferedCreateInput) => Effect.Effect<ServiceOffered, SqlError>;
    updateByIdForUser: (id: string, userId: string, input: ServiceOfferedUpdateInput) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
    softDeleteByIdForUser: (id: string, userId: string) => Effect.Effect<ServiceOffered, SqlError | DBNotFoundError>;
  }
>() {}

export const ServiceOfferedRepoLive = Layer.effect(
  ServiceOfferedRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<ServiceOffered>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }
      return Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: id }));
    };

    return {
      listByUserId: (userId) =>
        db
          .select()
          .from(serviceOffered)
          .where(and(eq(serviceOffered.userId, userId), isNull(serviceOffered.deletedAt))),
      create: (input) =>
        db
          .insert(serviceOffered)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      updateByIdForUser: (id, userId, input) =>
        db
          .update(serviceOffered)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(serviceOffered.id, id), eq(serviceOffered.userId, userId), isNull(serviceOffered.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      softDeleteByIdForUser: (id, userId) =>
        db
          .update(serviceOffered)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(serviceOffered.id, id), eq(serviceOffered.userId, userId), isNull(serviceOffered.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
    };
  }),
);

export const ServiceOfferedRepoDefault = ServiceOfferedRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeServiceOfferedRepoTest = (implementation: Context.Tag.Service<ServiceOfferedRepo>) =>
  Layer.succeed(ServiceOfferedRepo, implementation);

export const EmptyServiceOfferedRepoTest = makeServiceOfferedRepoTest({
  listByUserId: () => Effect.succeed([]),
  create: () => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: "" }) as never),
  updateByIdForUser: () => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: "" })),
  softDeleteByIdForUser: () => Effect.fail(new DBNotFoundError({ entity: "serviceOffered", value: "" })),
});
