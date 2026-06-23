import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, InferSelectModel, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { kycDocument, kycDocumentType } from "../schema";

export type KycDocument = InferSelectModel<typeof kycDocument>;
export type KycDocumentTypeForDocument = InferSelectModel<typeof kycDocumentType>;
export type KycDocumentStatus = KycDocument["status"];
export type KycDocumentWithType = KycDocument & { documentType: KycDocumentTypeForDocument };

export type KycDocumentSubmitInput = {
  userId: string;
  documentTypeId: string;
  filename: string;
  fileKey: string;
  expiryDate: Date | null;
};

export class KycDocumentRepo extends Context.Tag("@repo/db/KycDocumentRepo")<
  KycDocumentRepo,
  {
    findByIdWithType: (id: string) => Effect.Effect<KycDocumentWithType, SqlError | DBNotFoundError>;
    findByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
    findByUserIdWithTypes: (userId: string) => Effect.Effect<Array<KycDocumentWithType>, SqlError>;
    submit: (input: KycDocumentSubmitInput) => Effect.Effect<KycDocument, SqlError>;
    updateExpiryDate: (id: string, expiryDate: Date | null) => Effect.Effect<KycDocument, SqlError | DBNotFoundError>;
    approveSubmittedByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
  }
>() {}

const withType = (row: { document: KycDocument; documentType: KycDocumentTypeForDocument }): KycDocumentWithType => ({
  ...row.document,
  documentType: row.documentType,
});

export const KycDocumentRepoLive = Layer.effect(
  KycDocumentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      findByIdWithType: (id) =>
        db
          .select({ document: kycDocument, documentType: kycDocumentType })
          .from(kycDocument)
          .innerJoin(kycDocumentType, eq(kycDocument.documentTypeId, kycDocumentType.id))
          .where(eq(kycDocument.id, id))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];

              if (row) {
                return Effect.succeed(withType(row));
              }

              return Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id }));
            }),
          ),
      findByUserId: (userId) =>
        db
          .select()
          .from(kycDocument)
          .where(and(eq(kycDocument.userId, userId), isNull(kycDocument.deletedAt))),
      findByUserIdWithTypes: (userId) =>
        db
          .select({ document: kycDocument, documentType: kycDocumentType })
          .from(kycDocument)
          .innerJoin(kycDocumentType, eq(kycDocument.documentTypeId, kycDocumentType.id))
          .where(and(eq(kycDocument.userId, userId), isNull(kycDocument.deletedAt)))
          .pipe(Effect.map((rows) => rows.map(withType))),
      submit: (input) =>
        db
          .insert(kycDocument)
          .values({
            userId: input.userId,
            documentTypeId: input.documentTypeId,
            filename: input.filename,
            fileKey: input.fileKey,
            expiryDate: input.expiryDate,
            status: "submitted",
            reason: null,
            deletedAt: null,
          })
          .onConflictDoUpdate({
            target: [kycDocument.userId, kycDocument.documentTypeId],
            set: {
              filename: input.filename,
              fileKey: input.fileKey,
              expiryDate: input.expiryDate,
              status: "submitted",
              reason: null,
              deletedAt: null,
              updatedAt: new Date(),
            },
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      updateExpiryDate: (id, expiryDate) =>
        db
          .update(kycDocument)
          .set({ expiryDate, updatedAt: new Date() })
          .where(eq(kycDocument.id, id))
          .returning()
          .pipe(
            Effect.flatMap((rows) => {
              if (rows[0]) {
                return Effect.succeed(rows[0]);
              }

              return Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: id }));
            }),
          ),
      approveSubmittedByUserId: (userId) =>
        db
          .update(kycDocument)
          .set({ status: "approved", reason: null, updatedAt: new Date() })
          .where(and(eq(kycDocument.userId, userId), eq(kycDocument.status, "submitted")))
          .returning(),
    };
  }),
);

export const KycDocumentRepoDefault = KycDocumentRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeKycDocumentRepoTest = (implementation: Context.Tag.Service<KycDocumentRepo>) =>
  Layer.succeed(KycDocumentRepo, implementation);

export const EmptyKycDocumentRepoTest = makeKycDocumentRepoTest({
  findByIdWithType: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" })),
  findByUserId: () => Effect.succeed([]),
  findByUserIdWithTypes: () => Effect.succeed([]),
  submit: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" }) as never),
  updateExpiryDate: () => Effect.fail(new DBNotFoundError({ entity: "kycDocument", value: "" })),
  approveSubmittedByUserId: () => Effect.succeed([]),
});
