import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, type InferInsertModel, type InferSelectModel, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { serviceCatalogueItem } from "../schema";

export type ServiceCatalogueItem = InferSelectModel<typeof serviceCatalogueItem>;
export type ServiceCatalogueItemInsert = InferInsertModel<typeof serviceCatalogueItem>;
export type ServiceCatalogueItemCreateInput = Pick<
  ServiceCatalogueItemInsert,
  "name" | "category" | "baseHourlyRateCents" | "currency" | "isLive"
>;
export type ServiceCatalogueItemUpdateInput = Partial<
  Pick<ServiceCatalogueItem, "name" | "category" | "baseHourlyRateCents" | "currency" | "isLive">
>;

export class ServiceCatalogueRepo extends Context.Tag("@repo/db/ServiceCatalogueRepo")<
  ServiceCatalogueRepo,
  {
    listActive: () => Effect.Effect<Array<ServiceCatalogueItem>, SqlError>;
    listLive: () => Effect.Effect<Array<ServiceCatalogueItem>, SqlError>;
    findActiveById: (id: string) => Effect.Effect<ServiceCatalogueItem, SqlError | DBNotFoundError>;
    /** Soft-deleted items included — for resolving existing service links. */
    findById: (id: string) => Effect.Effect<ServiceCatalogueItem, SqlError | DBNotFoundError>;
    create: (input: ServiceCatalogueItemCreateInput) => Effect.Effect<ServiceCatalogueItem, SqlError>;
    update: (id: string, input: ServiceCatalogueItemUpdateInput) => Effect.Effect<ServiceCatalogueItem, SqlError | DBNotFoundError>;
    softDelete: (id: string) => Effect.Effect<ServiceCatalogueItem, SqlError | DBNotFoundError>;
  }
>() {}

export const ServiceCatalogueRepoLive = Layer.effect(
  ServiceCatalogueRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<ServiceCatalogueItem>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }

      return Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: id }));
    };

    return {
      listActive: () => db.select().from(serviceCatalogueItem).where(isNull(serviceCatalogueItem.deletedAt)),
      listLive: () =>
        db
          .select()
          .from(serviceCatalogueItem)
          .where(and(isNull(serviceCatalogueItem.deletedAt), eq(serviceCatalogueItem.isLive, true))),
      findActiveById: (id) =>
        db
          .select()
          .from(serviceCatalogueItem)
          .where(and(eq(serviceCatalogueItem.id, id), isNull(serviceCatalogueItem.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      findById: (id) =>
        db
          .select()
          .from(serviceCatalogueItem)
          .where(eq(serviceCatalogueItem.id, id))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      create: (input) =>
        db
          .insert(serviceCatalogueItem)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      update: (id, input) =>
        db
          .update(serviceCatalogueItem)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(serviceCatalogueItem.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      softDelete: (id) =>
        db
          .update(serviceCatalogueItem)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(serviceCatalogueItem.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
    };
  }),
);

export const ServiceCatalogueRepoDefault = ServiceCatalogueRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeServiceCatalogueRepoTest = (implementation: Context.Tag.Service<ServiceCatalogueRepo>) =>
  Layer.succeed(ServiceCatalogueRepo, implementation);

export const EmptyServiceCatalogueRepoTest = makeServiceCatalogueRepoTest({
  listActive: () => Effect.succeed([]),
  listLive: () => Effect.succeed([]),
  findActiveById: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" })),
  findById: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" })),
  create: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" }) as never),
  update: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" })),
  softDelete: () => Effect.fail(new DBNotFoundError({ entity: "serviceCatalogueItem", value: "" })),
});
