import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, count, desc, eq, type InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { approvalRequest, user, userProfile } from "../schema";

export type ApprovalRequest = InferSelectModel<typeof approvalRequest>;
export type ApprovalRequestStatus = ApprovalRequest["status"];

export type ApprovalRequestApplicant = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type ApprovalRequestWithApplicant = ApprovalRequest & {
  applicant: ApprovalRequestApplicant;
};

export type ApprovalRequestStatusCounts = Record<ApprovalRequestStatus, number>;

export class ApprovalRequestRepo extends Context.Tag("@repo/db/ApprovalRequestRepo")<
  ApprovalRequestRepo,
  {
    createSubmitted: (userId: string) => Effect.Effect<ApprovalRequest, SqlError>;
    list: (limit: number) => Effect.Effect<Array<ApprovalRequest>, SqlError>;
    listWithApplicant: (limit: number) => Effect.Effect<Array<ApprovalRequestWithApplicant>, SqlError>;
    countByStatus: () => Effect.Effect<ApprovalRequestStatusCounts, SqlError>;
    listByUserId: (userId: string) => Effect.Effect<Array<ApprovalRequest>, SqlError>;
    findById: (id: string) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
    findSubmittedByUserId: (userId: string) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
    findLatestByUserId: (userId: string) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
    markApproved: (id: string, reviewedBy: string) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
    reject: (id: string, reviewedBy: string, reason: string) => Effect.Effect<ApprovalRequest, SqlError | DBNotFoundError>;
  }
>() { }

const oneOrNotFound = (id: string) => (rows: Array<ApprovalRequest>) => {
  if (rows[0]) {
    return Effect.succeed(rows[0]);
  }
  return Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: id }));
};

export const ApprovalRequestRepoLive = Layer.effect(
  ApprovalRequestRepo,
  Effect.gen(function*() {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      createSubmitted: (userId) =>
        db
          .insert(approvalRequest)
          .values({ userId, status: "submitted" })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      list: (limit = 50) => db.select().from(approvalRequest).orderBy(desc(approvalRequest.createdAt)).limit(limit),
      listWithApplicant: (limit = 50) =>
        db
          .select({
            request: approvalRequest,
            email: user.email,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName,
          })
          .from(approvalRequest)
          .innerJoin(user, eq(approvalRequest.userId, user.id))
          .leftJoin(userProfile, eq(approvalRequest.userId, userProfile.userId))
          .orderBy(desc(approvalRequest.createdAt))
          .limit(limit)
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                ...row.request,
                applicant: {
                  email: row.email,
                  firstName: row.firstName ?? null,
                  lastName: row.lastName ?? null,
                },
              })),
            ),
          ),
      countByStatus: () =>
        db
          .select({ status: approvalRequest.status, total: count() })
          .from(approvalRequest)
          .groupBy(approvalRequest.status)
          .pipe(
            Effect.map((rows) => {
              const counts: ApprovalRequestStatusCounts = { submitted: 0, approved: 0, rejected: 0 };
              for (const row of rows) {
                counts[row.status] = Number(row.total);
              }
              return counts;
            }),
          ),
      listByUserId: (userId) =>
        db
          .select()
          .from(approvalRequest)
          .where(eq(approvalRequest.userId, userId))
          .orderBy(desc(approvalRequest.createdAt)),
      findById: (id) =>
        db
          .select()
          .from(approvalRequest)
          .where(eq(approvalRequest.id, id))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      findSubmittedByUserId: (userId) =>
        db
          .select()
          .from(approvalRequest)
          .where(and(eq(approvalRequest.userId, userId), eq(approvalRequest.status, "submitted")))
          .orderBy(desc(approvalRequest.createdAt))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(userId))),
      findLatestByUserId: (userId) =>
        db
          .select()
          .from(approvalRequest)
          .where(eq(approvalRequest.userId, userId))
          .orderBy(desc(approvalRequest.createdAt))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(userId))),
      markApproved: (id, reviewedBy) =>
        db
          .update(approvalRequest)
          .set({ status: "approved", reviewedBy, reviewedAt: new Date(), reason: null, updatedAt: new Date() })
          .where(eq(approvalRequest.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
      reject: (id, reviewedBy, reason) =>
        db
          .update(approvalRequest)
          .set({ status: "rejected", reviewedBy, reviewedAt: new Date(), reason, updatedAt: new Date() })
          .where(eq(approvalRequest.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),
    };
  }),
);

export const ApprovalRequestRepoDefault = ApprovalRequestRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeApprovalRequestRepoTest = (implementation: Context.Tag.Service<ApprovalRequestRepo>) =>
  Layer.succeed(ApprovalRequestRepo, implementation);

export const EmptyApprovalRequestRepoTest = makeApprovalRequestRepoTest({
  createSubmitted: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" }) as never),
  list: () => Effect.succeed([]),
  listWithApplicant: () => Effect.succeed([]),
  countByStatus: () => Effect.succeed({ submitted: 0, approved: 0, rejected: 0 }),
  listByUserId: () => Effect.succeed([]),
  findById: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  findSubmittedByUserId: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  findLatestByUserId: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  markApproved: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  reject: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
});
