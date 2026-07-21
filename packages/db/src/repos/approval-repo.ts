import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, desc, eq, gt, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive, DBNotFoundError } from "../effect-db";
import { approval } from "../schema";

export type Approval = InferSelectModel<typeof approval>;
export type NewApproval = InferInsertModel<typeof approval>;

export type ApprovalCreateInput = Pick<
  NewApproval,
  'userId'
  | 'approvalRequestId'
  | 'approvedBy'
  | 'status'
  | 'expiresAt'
>;

export class ApprovalRepo extends Context.Tag("@repo/db/ApprovalRepo")<
  ApprovalRepo,
  {
    create: (input: ApprovalCreateInput) => Effect.Effect<Approval, SqlError>;
    findCurrentByUserId: (userId: string) => Effect.Effect<Approval, SqlError | DBNotFoundError>;
    listByUserId: (userId: string) => Effect.Effect<Array<Approval>, SqlError>;
  }
>() { }

export const ApprovalRepoLive = Layer.effect(
  ApprovalRepo,
  Effect.gen(function*() {
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
              gt(approval.expiresAt, new Date()),
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

              return Effect.fail(new DBNotFoundError({ entity: "approval", value: userId }));
            }),
          ),
      listByUserId: (userId) =>
        db
          .select()
          .from(approval)
          .where(eq(approval.userId, userId))
          .orderBy(desc(approval.createdAt)),
    };
  }),
);

export const ApprovalRepoDefault = ApprovalRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeApprovalRepoTest = (implementation: Context.Tag.Service<ApprovalRepo>) =>
  Layer.succeed(ApprovalRepo, implementation);

export const EmptyApprovalRepoTest = makeApprovalRepoTest({
  create: () => Effect.fail(new DBNotFoundError({ entity: "approval", value: "" }) as never),
  findCurrentByUserId: () => Effect.fail(new DBNotFoundError({ entity: "approval", value: "" })),
  listByUserId: () => Effect.succeed([]),
});
