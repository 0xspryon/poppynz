import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gte,
  isNull,
  isNotNull,
  lt,
  lte,
  notInArray,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { safetyVerification } from '../schema';

export type SafetyVerification = InferSelectModel<typeof safetyVerification>;
export type SafetyVerificationInsert = InferInsertModel<typeof safetyVerification>;
export type SafetyVerificationStatus = SafetyVerification['status'];
export type SafetyVerificationRole = SafetyVerification['role'];
export type SafetyVerificationRoute = SafetyVerification['route'];

/** A verdict is only ever created with evidence behind it, so its status and
 * route are the caller's to state — there is no "not started" row. */
export type SafetyVerificationCreateInput = Pick<
  SafetyVerificationInsert,
  'userId' | 'role' | 'status' | 'route'
> &
  Partial<
    Pick<
      SafetyVerificationInsert,
      | 'checkOrderId'
      | 'consentAt'
      | 'consentPolicyVersion'
      | 'issuingAuthority'
      | 'documentNumber'
      | 'filename'
      | 'fileKey'
      | 'issuedOn'
      | 'expiresOn'
    >
  >;

export type SafetyVerificationUpdateInput = Partial<
  Omit<SafetyVerification, 'id' | 'userId' | 'role' | 'createdAt' | 'updatedAt'>
>;

/** Statuses a record can never move out of — they are kept purely as history,
 * and the partial unique index treats them as not occupying the live slot. */
export const terminalSafetyVerificationStatuses: Array<SafetyVerificationStatus> = [
  'rejected',
  'expired'
];

export class SafetyVerificationRepo extends Context.Tag('@repo/db/SafetyVerificationRepo')<
  SafetyVerificationRepo,
  {
    /** The one record occupying the live slot for this applicant and role, if
     * any. Excludes rejected and expired history. */
    findLive: (
      userId: string,
      role: SafetyVerificationRole
    ) => Effect.Effect<SafetyVerification | null, SqlError>;
    findById: (id: string) => Effect.Effect<SafetyVerification, SqlError | DBNotFoundError>;
    listByUser: (userId: string) => Effect.Effect<Array<SafetyVerification>, SqlError>;
    listForReview: () => Effect.Effect<Array<SafetyVerification>, SqlError>;
    create: (input: SafetyVerificationCreateInput) => Effect.Effect<SafetyVerification, SqlError>;
    update: (
      id: string,
      input: SafetyVerificationUpdateInput
    ) => Effect.Effect<SafetyVerification, SqlError | DBNotFoundError>;
    /** Verified records whose expiry falls inside the reminder window and that
     * have not been reminded yet. */
    listExpiringForNotification: (
      from: string,
      until: string
    ) => Effect.Effect<Array<SafetyVerification>, SqlError>;
    markExpiryNotified: (
      id: string,
      at: Date
    ) => Effect.Effect<SafetyVerification, SqlError | DBNotFoundError>;
    /** Verified records already past their expiry date, for the daily sweep. */
    listLapsed: (today: string) => Effect.Effect<Array<SafetyVerification>, SqlError>;
  }
>() {}

export const SafetyVerificationRepoLive = Layer.effect(
  SafetyVerificationRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<SafetyVerification>) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: id }));
    const firstOrNull = (rows: Array<SafetyVerification>) => rows[0] ?? null;

    return {
      findLive: (userId, role) =>
        db
          .select()
          .from(safetyVerification)
          .where(
            and(
              eq(safetyVerification.userId, userId),
              eq(safetyVerification.role, role),
              isNull(safetyVerification.deletedAt),
              notInArray(safetyVerification.status, terminalSafetyVerificationStatuses)
            )
          )
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      findById: (id) =>
        db
          .select()
          .from(safetyVerification)
          .where(and(eq(safetyVerification.id, id), isNull(safetyVerification.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      listByUser: (userId) =>
        db
          .select()
          .from(safetyVerification)
          .where(
            and(eq(safetyVerification.userId, userId), isNull(safetyVerification.deletedAt))
          )
          .orderBy(desc(safetyVerification.createdAt)),

      listForReview: () =>
        db
          .select()
          .from(safetyVerification)
          .where(
            and(
              eq(safetyVerification.status, 'review_required'),
              isNull(safetyVerification.deletedAt)
            )
          )
          .orderBy(safetyVerification.createdAt),

      create: (input) =>
        db.insert(safetyVerification).values(input).returning().pipe(Effect.map((rows) => rows[0])),

      update: (id, input) =>
        db
          .update(safetyVerification)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(safetyVerification.id, id), isNull(safetyVerification.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      listExpiringForNotification: (from, until) =>
        db
          .select()
          .from(safetyVerification)
          .where(
            and(
              eq(safetyVerification.status, 'verified'),
              isNull(safetyVerification.deletedAt),
              isNull(safetyVerification.expiryNotifiedAt),
              isNotNull(safetyVerification.expiresOn),
              gte(safetyVerification.expiresOn, from),
              lte(safetyVerification.expiresOn, until)
            )
          )
          .orderBy(safetyVerification.expiresOn),

      markExpiryNotified: (id, at) =>
        db
          .update(safetyVerification)
          .set({ expiryNotifiedAt: at, updatedAt: new Date() })
          .where(eq(safetyVerification.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      listLapsed: (today) =>
        db
          .select()
          .from(safetyVerification)
          .where(
            and(
              eq(safetyVerification.status, 'verified'),
              isNull(safetyVerification.deletedAt),
              isNotNull(safetyVerification.expiresOn),
              lt(safetyVerification.expiresOn, today)
            )
          )
    };
  })
);

export const SafetyVerificationRepoDefault = SafetyVerificationRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

export const makeSafetyVerificationRepoTest = (
  implementation: Context.Tag.Service<SafetyVerificationRepo>
) => Layer.succeed(SafetyVerificationRepo, implementation);

const notFound = () =>
  Effect.fail(new DBNotFoundError({ entity: 'safetyVerification', value: '' }));

export const EmptySafetyVerificationRepoTest = makeSafetyVerificationRepoTest({
  findLive: () => Effect.succeed(null),
  findById: notFound,
  listByUser: () => Effect.succeed([]),
  listForReview: () => Effect.succeed([]),
  create: () => notFound() as never,
  update: notFound,
  listExpiringForNotification: () => Effect.succeed([]),
  markExpiryNotified: notFound,
  listLapsed: () => Effect.succeed([])
});
