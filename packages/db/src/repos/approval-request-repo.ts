import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, desc, eq, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { approvalRequest } from "../schema";

export type ApprovalRequest = InferSelectModel<typeof approvalRequest>;
export type ApprovalRequestStatus = ApprovalRequest["status"];

export class ApprovalRequestRepo extends Context.Tag("@repo/db/ApprovalRequestRepo")<
  ApprovalRequestRepo,
  {
    createSubmitted: (userId: string) => Effect.Effect<ApprovalRequest, SqlError>;
    list: (limit: number) => Effect.Effect<Array<ApprovalRequest>, SqlError>;
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
  findById: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  findSubmittedByUserId: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  findLatestByUserId: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  markApproved: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
  reject: () => Effect.fail(new DBNotFoundError({ entity: "approvalRequest", value: "" })),
});
