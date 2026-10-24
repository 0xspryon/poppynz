import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, gte, type InferSelectModel, isNull, lt } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { kycDocument, kycDocumentType } from '../schema';

export type KycDocument = InferSelectModel<typeof kycDocument>;
export type KycDocumentTypeForDocument = InferSelectModel<typeof kycDocumentType>;
export type KycDocumentStatus = KycDocument['status'];
export type KycDocumentSource = KycDocument['source'];
export type KycDocumentWithType = KycDocument & { documentType: KycDocumentTypeForDocument };

export type KycDocumentSubmitInput = {
  userId: string;
  documentTypeId: string;
  filename: string;
  fileKey: string;
  expiryDate: Date | null;
  issuedOn?: string | null;
};

export type KycDocumentReviewInput = {
  status: 'approved' | 'rejected';
  reason: string | null;
  reviewedBy: string;
};

export class KycDocumentRepo extends Context.Tag('@repo/db/KycDocumentRepo')<
  KycDocumentRepo,
  {
    findByIdWithType: (
      id: string
    ) => Effect.Effect<KycDocumentWithType, SqlError | DBNotFoundError>;
    findByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
    findByUserIdWithTypes: (userId: string) => Effect.Effect<Array<KycDocumentWithType>, SqlError>;
    submit: (input: KycDocumentSubmitInput) => Effect.Effect<KycDocument, SqlError>;
    updateExpiryDate: (
      id: string,
      expiryDate: Date | null
    ) => Effect.Effect<KycDocument, SqlError | DBNotFoundError>;
    approveSubmittedByUserId: (userId: string) => Effect.Effect<Array<KycDocument>, SqlError>;
    /** Helpers (distinct user ids) holding an approved, live document whose
     * expiry date falls in [from, to) — the daily sweep re-indexes them so a
     * lapsed credential's gated service leaves search (R9). */
    listUserIdsWithApprovedExpiringBetween: (
      from: Date,
      to: Date
    ) => Effect.Effect<Array<string>, SqlError>;
    /** Records an admin decision on one live document (UAT #27). */
    review: (
      id: string,
      input: KycDocumentReviewInput
    ) => Effect.Effect<KycDocument, SqlError | DBNotFoundError>;
  }
>() {}

const withType = (row: {
  document: KycDocument;
  documentType: KycDocumentTypeForDocument;
}): KycDocumentWithType => ({
  ...row.document,
  documentType: row.documentType
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

              return Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id }));
            })
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
            issuedOn: input.issuedOn ?? null,
            status: 'submitted',
            source: 'upload',
            reason: null,
            reviewedBy: null,
            reviewedAt: null,
            deletedAt: null
          })
          .onConflictDoUpdate({
            target: [kycDocument.userId, kycDocument.documentTypeId],
            // An upload supersedes whatever was there — including a document
            // Credibled fetched — so `source` is reset along with the file.
            set: {
              filename: input.filename,
              fileKey: input.fileKey,
              expiryDate: input.expiryDate,
              issuedOn: input.issuedOn ?? null,
              status: 'submitted',
              source: 'upload',
              reason: null,
              // A new file is a new review.
              reviewedBy: null,
              reviewedAt: null,
              deletedAt: null,
              updatedAt: new Date()
            }
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

              return Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id }));
            })
          ),
      listUserIdsWithApprovedExpiringBetween: (from, to) =>
        db
          .selectDistinct({ userId: kycDocument.userId })
          .from(kycDocument)
          .where(
            and(
              eq(kycDocument.status, 'approved'),
              isNull(kycDocument.deletedAt),
              gte(kycDocument.expiryDate, from),
              lt(kycDocument.expiryDate, to)
            )
          )
          .pipe(Effect.map((rows) => rows.map((row) => row.userId))),
      approveSubmittedByUserId: (userId) =>
        db
          .update(kycDocument)
          .set({ status: 'approved', reason: null, updatedAt: new Date() })
          .where(and(eq(kycDocument.userId, userId), eq(kycDocument.status, 'submitted')))
          .returning(),
      review: (id, input) =>
        db
          .update(kycDocument)
          .set({
            status: input.status,
            reason: input.reason,
            reviewedBy: input.reviewedBy,
            reviewedAt: new Date(),
            updatedAt: new Date()
          })
          .where(and(eq(kycDocument.id, id), isNull(kycDocument.deletedAt)))
          .returning()
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id }))
            )
          )
    };
  })
);

export const KycDocumentRepoDefault = KycDocumentRepoLive.pipe(Layer.provide(DrizzleLive));

type KycDocumentService = Context.Tag.Service<KycDocumentRepo>;

/** `review` defaults to not-found and the expiry listing to empty so older
 * tests compile unchanged. */
export const makeKycDocumentRepoTest = (
  implementation: Omit<KycDocumentService, 'review' | 'listUserIdsWithApprovedExpiringBetween'> &
    Partial<Pick<KycDocumentService, 'review' | 'listUserIdsWithApprovedExpiringBetween'>>
) =>
  Layer.succeed(KycDocumentRepo, {
    review: (id) => Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: id })),
    listUserIdsWithApprovedExpiringBetween: () => Effect.succeed([]),
    ...implementation
  });

export const EmptyKycDocumentRepoTest = makeKycDocumentRepoTest({
  findByIdWithType: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: '' })),
  findByUserId: () => Effect.succeed([]),
  findByUserIdWithTypes: () => Effect.succeed([]),
  submit: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: '' }) as never),
  updateExpiryDate: () => Effect.fail(new DBNotFoundError({ entity: 'kycDocument', value: '' })),
  approveSubmittedByUserId: () => Effect.succeed([])
});
