import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, type InferInsertModel, type InferSelectModel, isNull } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { kycDocumentType } from '../schema';

export type KycDocumentType = InferSelectModel<typeof kycDocumentType>;
export type KycDocumentTypeInsert = InferInsertModel<typeof kycDocumentType>;
export type KycDocumentTypeCreateInput = Pick<
  KycDocumentTypeInsert,
  'name' | 'isOptional' | 'requiresExpiryDate' | 'isFetchable'
> & {
  appliesToRole?: KycDocumentType['appliesToRole'];
};
export type KycDocumentTypeUpdateInput = Partial<
  Pick<
    KycDocumentType,
    'name' | 'isOptional' | 'requiresExpiryDate' | 'isFetchable' | 'appliesToRole'
  >
>;

export class KycDocumentTypeRepo extends Context.Tag('@repo/db/KycDocumentTypeRepo')<
  KycDocumentTypeRepo,
  {
    listActive: () => Effect.Effect<Array<KycDocumentType>, SqlError>;
    findActiveById: (id: string) => Effect.Effect<KycDocumentType, SqlError | DBNotFoundError>;
    create: (input: KycDocumentTypeCreateInput) => Effect.Effect<KycDocumentType, SqlError>;
    update: (
      id: string,
      input: KycDocumentTypeUpdateInput
    ) => Effect.Effect<KycDocumentType, SqlError | DBNotFoundError>;
    softDelete: (id: string) => Effect.Effect<KycDocumentType, SqlError | DBNotFoundError>;
  }
>() {}

export const KycDocumentTypeRepoLive = Layer.effect(
  KycDocumentTypeRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<KycDocumentType>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }

      return Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: id }));
    };

    return {
      listActive: () => db.select().from(kycDocumentType).where(isNull(kycDocumentType.deletedAt)),
      findActiveById: (id) =>
        db
          .select()
          .from(kycDocumentType)
          .where(and(eq(kycDocumentType.id, id), isNull(kycDocumentType.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      create: (input) =>
        db
          .insert(kycDocumentType)
          .values({ ...input, appliesToRole: input.appliesToRole ?? 'service-provider' })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      update: (id, input) =>
        db
          .update(kycDocumentType)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(kycDocumentType.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      softDelete: (id) =>
        db
          .update(kycDocumentType)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(kycDocumentType.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id)))
    };
  })
);

export const KycDocumentTypeRepoDefault = KycDocumentTypeRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeKycDocumentTypeRepoTest = (
  implementation: Context.Tag.Service<KycDocumentTypeRepo>
) => Layer.succeed(KycDocumentTypeRepo, implementation);

export const EmptyKycDocumentTypeRepoTest = makeKycDocumentTypeRepoTest({
  listActive: () => Effect.succeed([]),
  findActiveById: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' })),
  create: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' }) as never),
  update: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' })),
  softDelete: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocumentType', value: '' }))
});
