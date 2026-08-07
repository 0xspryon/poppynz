import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, type InferSelectModel, isNull } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { serviceNeeded } from '../schema';

export type ServiceNeeded = InferSelectModel<typeof serviceNeeded>;
export type ServiceNeededCreateInput = {
  userId: string;
  catalogueServiceId?: string | null;
  name: string;
  description?: string | null;
};
export type ServiceNeededUpdateInput = Partial<
  Pick<ServiceNeeded, 'name' | 'description' | 'catalogueServiceId'>
>;

export class ServiceNeededRepo extends Context.Tag('@repo/db/ServiceNeededRepo')<
  ServiceNeededRepo,
  {
    listByUserId: (userId: string) => Effect.Effect<Array<ServiceNeeded>, SqlError>;
    findByIdForUser: (
      id: string,
      userId: string
    ) => Effect.Effect<ServiceNeeded, SqlError | DBNotFoundError>;
    create: (input: ServiceNeededCreateInput) => Effect.Effect<ServiceNeeded, SqlError>;
    updateByIdForUser: (
      id: string,
      userId: string,
      input: ServiceNeededUpdateInput
    ) => Effect.Effect<ServiceNeeded, SqlError | DBNotFoundError>;
    softDeleteByIdForUser: (
      id: string,
      userId: string
    ) => Effect.Effect<ServiceNeeded, SqlError | DBNotFoundError>;
  }
>() {}

export const ServiceNeededRepoLive = Layer.effect(
  ServiceNeededRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<ServiceNeeded>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }
      return Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: id }));
    };

    return {
      listByUserId: (userId) =>
        db
          .select()
          .from(serviceNeeded)
          .where(and(eq(serviceNeeded.userId, userId), isNull(serviceNeeded.deletedAt))),
      findByIdForUser: (id, userId) =>
        db
          .select()
          .from(serviceNeeded)
          .where(
            and(
              eq(serviceNeeded.id, id),
              eq(serviceNeeded.userId, userId),
              isNull(serviceNeeded.deletedAt)
            )
          )
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      create: (input) =>
        db
          .insert(serviceNeeded)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      updateByIdForUser: (id, userId, input) =>
        db
          .update(serviceNeeded)
          .set({ ...input, updatedAt: new Date() })
          .where(
            and(
              eq(serviceNeeded.id, id),
              eq(serviceNeeded.userId, userId),
              isNull(serviceNeeded.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      softDeleteByIdForUser: (id, userId) =>
        db
          .update(serviceNeeded)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(serviceNeeded.id, id),
              eq(serviceNeeded.userId, userId),
              isNull(serviceNeeded.deletedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id)))
    };
  })
);

export const ServiceNeededRepoDefault = ServiceNeededRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeServiceNeededRepoTest = (implementation: Context.Tag.Service<ServiceNeededRepo>) =>
  Layer.succeed(ServiceNeededRepo, implementation);

export const EmptyServiceNeededRepoTest = makeServiceNeededRepoTest({
  listByUserId: () => Effect.succeed([]),
  findByIdForUser: () => Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: '' })),
  create: () => Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: '' }) as never),
  updateByIdForUser: () => Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: '' })),
  softDeleteByIdForUser: () =>
    Effect.fail(new DBNotFoundError({ entity: 'serviceNeeded', value: '' }))
});
