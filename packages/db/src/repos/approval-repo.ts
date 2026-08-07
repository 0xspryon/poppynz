import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lte,
  ne,
  or,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive, DBNotFoundError } from '../effect-db';
import { approval, user } from '../schema';

export type Approval = InferSelectModel<typeof approval>;
export type NewApproval = InferInsertModel<typeof approval>;

export type ApprovalCreateInput = Pick<
  NewApproval,
  'userId' | 'approvalRequestId' | 'approvedBy' | 'status' | 'expiresAt'
>;

/** Which expiry-warning tiers have fired; set to the firing time. */
export type ApprovalExpiryNotifiedStamps = Partial<
  Pick<
    Approval,
    | 'notifiedExpiresInOneMonthAt'
    | 'notifiedExpiresInTwoWeeksAt'
    | 'notifiedExpiresInOneWeekAt'
    | 'notifiedExpiresInTwoDaysAt'
  >
>;

export type ApprovalExpiryCandidate = Approval & {
  applicant: { email: string; name: string | null };
};

export class ApprovalRepo extends Context.Tag('@repo/db/ApprovalRepo')<
  ApprovalRepo,
  {
    create: (input: ApprovalCreateInput) => Effect.Effect<Approval, SqlError>;
    findCurrentByUserId: (userId: string) => Effect.Effect<Approval, SqlError | DBNotFoundError>;
    listByUserId: (userId: string) => Effect.Effect<Array<Approval>, SqlError>;
    revoke: (id: string, reason: string) => Effect.Effect<Approval, SqlError | DBNotFoundError>;
    /** Live approvals expiring in (now, until] whose applicant is not banned
     * and that may still owe a warning mail (two-days tier unfired — the
     * shortest tier is only ever stamped by an actual send, so a non-null
     * value means the approval is fully notified). */
    listExpiringForNotification: (
      now: Date,
      until: Date
    ) => Effect.Effect<Array<ApprovalExpiryCandidate>, SqlError>;
    markExpiryNotified: (
      id: string,
      stamps: ApprovalExpiryNotifiedStamps
    ) => Effect.Effect<Approval, SqlError | DBNotFoundError>;
  }
>() {}

export const ApprovalRepoLive = Layer.effect(
  ApprovalRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(approval)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findCurrentByUserId: (userId) =>
        db
          .select()
          .from(approval)
          .where(
            and(
              eq(approval.userId, userId),
              eq(approval.status, 'approved'),
              gt(approval.expiresAt, new Date())
            )
          )
          .orderBy(desc(approval.expiresAt))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];

              if (row) {
                return Effect.succeed(row);
              }

              return Effect.fail(new DBNotFoundError({ entity: 'approval', value: userId }));
            })
          ),
      listByUserId: (userId) =>
        db
          .select()
          .from(approval)
          .where(eq(approval.userId, userId))
          .orderBy(desc(approval.createdAt)),
      // Revocation flips a live approval to `rejected` — findCurrentByUserId
      // and the search-index candidate query both filter on status='approved',
      // so a revoked provider immediately loses verified standing.
      revoke: (id, reason) =>
        db
          .update(approval)
          .set({ status: 'rejected', reason, updatedAt: new Date() })
          .where(and(eq(approval.id, id), eq(approval.status, 'approved')))
          .returning()
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'approval', value: id }))
            )
          ),
      listExpiringForNotification: (now, until) =>
        db
          .select({ approval, applicantEmail: user.email, applicantName: user.name })
          .from(approval)
          .innerJoin(user, eq(approval.userId, user.id))
          .where(
            and(
              eq(approval.status, 'approved'),
              gt(approval.expiresAt, now),
              lte(approval.expiresAt, until),
              isNull(approval.notifiedExpiresInTwoDaysAt),
              or(isNull(user.banned), ne(user.banned, true))
            )
          )
          .orderBy(approval.expiresAt)
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row.approval,
                applicant: { email: row.applicantEmail, name: row.applicantName }
              }))
            )
          ),
      markExpiryNotified: (id, stamps) =>
        db
          .update(approval)
          .set({ ...stamps, updatedAt: new Date() })
          .where(eq(approval.id, id))
          .returning()
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'approval', value: id }))
            )
          )
    };
  })
);

export const ApprovalRepoDefault = ApprovalRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeApprovalRepoTest = (implementation: Partial<Context.Tag.Service<ApprovalRepo>>) =>
  Layer.succeed(ApprovalRepo, {
    create: () => Effect.fail(new DBNotFoundError({ entity: 'approval', value: '' }) as never),
    findCurrentByUserId: () => Effect.fail(new DBNotFoundError({ entity: 'approval', value: '' })),
    listByUserId: () => Effect.succeed([]),
    revoke: () => Effect.fail(new DBNotFoundError({ entity: 'approval', value: '' })),
    listExpiringForNotification: () => Effect.succeed([]),
    markExpiryNotified: () => Effect.fail(new DBNotFoundError({ entity: 'approval', value: '' })),
    ...implementation
  });

export const EmptyApprovalRepoTest = makeApprovalRepoTest({});
