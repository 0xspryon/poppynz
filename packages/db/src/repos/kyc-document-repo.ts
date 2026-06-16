import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, eq, inArray, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { kycDocument } from "../schema";

export type KycDocument = InferSelectModel<typeof kycDocument>;
export type KycDocumentType = KycDocument["type"];
export type KycDocumentStatus = KycDocument["status"];

export class KycDocumentRepo extends Context.Tag("@repo/db/KycDocumentRepo")<
  KycDocumentRepo,
  {
    findByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
    approveSubmittedByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
  }
>() {}

export const KycDocumentRepoLive = Layer.effect(
  KycDocumentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      findByUserId: (userId) =>
        db
          .select()
          .from(kycDocument)
          .where(eq(kycDocument.userId, userId)),
      approveSubmittedByUserId: (userId) =>
        db
          .update(kycDocument)
          .set({
            status: "approved",
            reason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(kycDocument.userId, userId),
              inArray(kycDocument.status, ["uploaded", "rejected"]),
            ),
          )
          .returning()
    };
  }),
);

export const KycDocumentRepoDefault = KycDocumentRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeKycDocumentRepoTest = (implementation: Context.Tag.Service<KycDocumentRepo>) =>
  Layer.succeed(KycDocumentRepo, implementation);

export const EmptyKycDocumentRepoTest = makeKycDocumentRepoTest({
  findByUserId: () => Effect.succeed([]),
  approveSubmittedByUserId: () => Effect.succeed([]),
})