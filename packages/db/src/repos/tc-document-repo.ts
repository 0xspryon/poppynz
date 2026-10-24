import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { tcDocument, tcDocumentAcceptance, tcDocumentVersion } from '../schema';
import { displayedVersion, TC_SOURCE_LOCALE, type TcLocale } from '../tc-locale';

export type TcDocument = InferSelectModel<typeof tcDocument>;
export type TcDocumentVersion = InferSelectModel<typeof tcDocumentVersion>;
export type TcDocumentAcceptance = InferSelectModel<typeof tcDocumentAcceptance>;
export type TcDocumentCreateInput = Pick<
  InferInsertModel<typeof tcDocument>,
  'slug' | 'title' | 'appliesToRole'
>;
export type TcDocumentUpdateInput = Partial<Pick<TcDocument, 'title' | 'appliesToRole'>>;
export type TcDraftInput = Pick<
  InferInsertModel<typeof tcDocumentVersion>,
  'description' | 'content' | 'checkboxLabel'
>;
export type TcDraftUpdateInput = Partial<TcDraftInput>;
export type TcAcceptanceInput = Pick<
  InferInsertModel<typeof tcDocumentAcceptance>,
  'documentId' | 'slug' | 'versionId' | 'version'
>;
/** A live document paired with the published version a reader is shown:
 * the translation of the current revision in their locale when there is
 * one, else the English text (`fallback`). */
export type TcPublishedDocument = {
  document: TcDocument;
  version: TcDocumentVersion;
  fallback: boolean;
};
export type TcAudienceRole = Exclude<TcDocument['appliesToRole'], 'all'>;

export class TcDocumentRepo extends Context.Tag('@repo/db/TcDocumentRepo')<
  TcDocumentRepo,
  {
    listActive: () => Effect.Effect<Array<TcDocument>, SqlError>;
    findActiveById: (id: string) => Effect.Effect<TcDocument, SqlError | DBNotFoundError>;
    findActiveBySlug: (slug: string) => Effect.Effect<TcDocument, SqlError | DBNotFoundError>;
    createDocument: (input: TcDocumentCreateInput) => Effect.Effect<TcDocument, SqlError>;
    updateDocument: (
      id: string,
      input: TcDocumentUpdateInput
    ) => Effect.Effect<TcDocument, SqlError | DBNotFoundError>;
    softDeleteDocument: (id: string) => Effect.Effect<TcDocument, SqlError | DBNotFoundError>;
    /** All versions of a document, newest first. */
    listVersions: (documentId: string) => Effect.Effect<Array<TcDocumentVersion>, SqlError>;
    /** Versions for many documents in one query — for the admin list page. */
    listVersionsByDocumentIds: (
      documentIds: Array<string>
    ) => Effect.Effect<Array<TcDocumentVersion>, SqlError>;
    /** Opens the document's single draft in `locale` at `version` (see
     * nextDraftVersion — the caller decides the number). */
    createDraft: (
      documentId: string,
      input: TcDraftInput & { locale: TcLocale; version: number }
    ) => Effect.Effect<TcDocumentVersion, SqlError | DBNotFoundError>;
    /** Edits the open draft only — published versions are immutable by design. */
    updateDraft: (
      documentId: string,
      input: TcDraftUpdateInput,
      locale?: TcLocale
    ) => Effect.Effect<TcDocumentVersion, SqlError | DBNotFoundError>;
    publishDraft: (
      documentId: string,
      locale?: TcLocale
    ) => Effect.Effect<TcDocumentVersion, SqlError | DBNotFoundError>;
    findLatestPublished: (
      documentId: string
    ) => Effect.Effect<TcDocumentVersion, SqlError | DBNotFoundError>;
    /** Live documents whose audience matches `role` (or "all"), each with
     * the current revision as shown in `locale`. */
    listPublishedForRole: (
      role: TcAudienceRole,
      locale?: TcLocale
    ) => Effect.Effect<Array<TcPublishedDocument>, SqlError>;
    /** Subset of listPublishedForRole whose current revision the user has
     * not accepted in any locale. */
    listPendingForUser: (
      userId: string,
      role: TcAudienceRole,
      locale?: TcLocale
    ) => Effect.Effect<Array<TcPublishedDocument>, SqlError>;
    listAcceptancesForUser: (
      userId: string
    ) => Effect.Effect<Array<TcDocumentAcceptance>, SqlError>;
    /** Append-only; re-accepting an already accepted version is a no-op. */
    insertAcceptances: (
      userId: string,
      items: Array<TcAcceptanceInput>
    ) => Effect.Effect<Array<TcDocumentAcceptance>, SqlError>;
  }
>() {}

export const TcDocumentRepoLive = Layer.effect(
  TcDocumentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const documentOrNotFound = (value: string) => (rows: Array<TcDocument>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }

      return Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value }));
    };
    const versionOrNotFound = (value: string) => (rows: Array<TcDocumentVersion>) => {
      if (rows[0]) {
        return Effect.succeed(rows[0]);
      }

      return Effect.fail(new DBNotFoundError({ entity: 'tcDocumentVersion', value }));
    };
    const listPublishedForRole = (role: TcAudienceRole, locale: TcLocale = TC_SOURCE_LOCALE) =>
      Effect.gen(function* () {
        const documents = yield* db
          .select()
          .from(tcDocument)
          .where(
            and(
              isNull(tcDocument.deletedAt),
              or(eq(tcDocument.appliesToRole, role), eq(tcDocument.appliesToRole, 'all'))
            )
          );
        if (documents.length === 0) {
          return [];
        }

        const versions = yield* db
          .select()
          .from(tcDocumentVersion)
          .where(
            and(
              inArray(
                tcDocumentVersion.documentId,
                documents.map((document) => document.id)
              ),
              isNotNull(tcDocumentVersion.publishedAt)
            )
          )
          .orderBy(desc(tcDocumentVersion.version));

        return documents.flatMap((document) => {
          const shown = displayedVersion(
            versions.filter((version) => version.documentId === document.id),
            locale
          );
          return shown ? [{ document, ...shown }] : [];
        });
      });

    return {
      listActive: () => db.select().from(tcDocument).where(isNull(tcDocument.deletedAt)),
      findActiveById: (id) =>
        db
          .select()
          .from(tcDocument)
          .where(and(eq(tcDocument.id, id), isNull(tcDocument.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(documentOrNotFound(id))),
      findActiveBySlug: (slug) =>
        db
          .select()
          .from(tcDocument)
          .where(and(eq(tcDocument.slug, slug), isNull(tcDocument.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(documentOrNotFound(slug))),
      createDocument: (input) =>
        db
          .insert(tcDocument)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      updateDocument: (id, input) =>
        db
          .update(tcDocument)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(tcDocument.id, id), isNull(tcDocument.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(documentOrNotFound(id))),
      softDeleteDocument: (id) =>
        db
          .update(tcDocument)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(tcDocument.id, id), isNull(tcDocument.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(documentOrNotFound(id))),
      listVersions: (documentId) =>
        db
          .select()
          .from(tcDocumentVersion)
          .where(eq(tcDocumentVersion.documentId, documentId))
          .orderBy(desc(tcDocumentVersion.version)),
      listVersionsByDocumentIds: (documentIds) =>
        documentIds.length === 0
          ? Effect.succeed([])
          : db
              .select()
              .from(tcDocumentVersion)
              .where(inArray(tcDocumentVersion.documentId, documentIds))
              .orderBy(desc(tcDocumentVersion.version)),
      createDraft: (documentId, input) =>
        Effect.gen(function* () {
          const document = yield* db
            .select()
            .from(tcDocument)
            .where(and(eq(tcDocument.id, documentId), isNull(tcDocument.deletedAt)))
            .limit(1)
            .pipe(Effect.flatMap(documentOrNotFound(documentId)));

          return yield* db
            .insert(tcDocumentVersion)
            .values({ documentId: document.id, ...input })
            .returning()
            .pipe(Effect.map((rows) => rows[0]));
        }),
      updateDraft: (documentId, input, locale = TC_SOURCE_LOCALE) =>
        db
          .update(tcDocumentVersion)
          .set({ ...input, updatedAt: new Date() })
          .where(
            and(
              eq(tcDocumentVersion.documentId, documentId),
              eq(tcDocumentVersion.locale, locale),
              isNull(tcDocumentVersion.publishedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(versionOrNotFound(documentId))),
      publishDraft: (documentId, locale = TC_SOURCE_LOCALE) =>
        db
          .update(tcDocumentVersion)
          .set({ publishedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(tcDocumentVersion.documentId, documentId),
              eq(tcDocumentVersion.locale, locale),
              isNull(tcDocumentVersion.publishedAt)
            )
          )
          .returning()
          .pipe(Effect.flatMap(versionOrNotFound(documentId))),
      findLatestPublished: (documentId) =>
        db
          .select()
          .from(tcDocumentVersion)
          .where(
            and(
              eq(tcDocumentVersion.documentId, documentId),
              eq(tcDocumentVersion.locale, TC_SOURCE_LOCALE),
              isNotNull(tcDocumentVersion.publishedAt)
            )
          )
          .orderBy(desc(tcDocumentVersion.version))
          .limit(1)
          .pipe(Effect.flatMap(versionOrNotFound(documentId))),
      listPublishedForRole,
      listPendingForUser: (userId, role, locale = TC_SOURCE_LOCALE) =>
        Effect.gen(function* () {
          const published = yield* listPublishedForRole(role, locale);
          if (published.length === 0) {
            return [];
          }

          // A revision accepted in either locale is accepted: the row's
          // version number is the revision, whichever text was read.
          const accepted = yield* db
            .select()
            .from(tcDocumentAcceptance)
            .where(
              and(
                eq(tcDocumentAcceptance.userId, userId),
                inArray(
                  tcDocumentAcceptance.documentId,
                  published.map((entry) => entry.document.id)
                )
              )
            );
          const acceptedRevisions = new Set(
            accepted.map((row) => `${row.documentId}:${row.version}`)
          );

          return published.filter(
            (entry) => !acceptedRevisions.has(`${entry.document.id}:${entry.version.version}`)
          );
        }),
      listAcceptancesForUser: (userId) =>
        db
          .select()
          .from(tcDocumentAcceptance)
          .where(eq(tcDocumentAcceptance.userId, userId))
          .orderBy(desc(tcDocumentAcceptance.acceptedAt)),
      insertAcceptances: (userId, items) =>
        items.length === 0
          ? Effect.succeed([])
          : db
              .insert(tcDocumentAcceptance)
              .values(items.map((item) => ({ ...item, userId })))
              .onConflictDoNothing()
              .returning()
    };
  })
);

export const TcDocumentRepoDefault = TcDocumentRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeTcDocumentRepoTest = (implementation: Context.Tag.Service<TcDocumentRepo>) =>
  Layer.succeed(TcDocumentRepo, implementation);

export const EmptyTcDocumentRepoTest = makeTcDocumentRepoTest({
  listActive: () => Effect.succeed([]),
  findActiveById: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' })),
  findActiveBySlug: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' })),
  createDocument: () =>
    Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' }) as never),
  updateDocument: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' })),
  softDeleteDocument: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' })),
  listVersions: () => Effect.succeed([]),
  listVersionsByDocumentIds: () => Effect.succeed([]),
  createDraft: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocument', value: '' })),
  updateDraft: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocumentVersion', value: '' })),
  publishDraft: () => Effect.fail(new DBNotFoundError({ entity: 'tcDocumentVersion', value: '' })),
  findLatestPublished: () =>
    Effect.fail(new DBNotFoundError({ entity: 'tcDocumentVersion', value: '' })),
  listPublishedForRole: () => Effect.succeed([]),
  listPendingForUser: () => Effect.succeed([]),
  listAcceptancesForUser: () => Effect.succeed([]),
  insertAcceptances: () => Effect.succeed([])
});
