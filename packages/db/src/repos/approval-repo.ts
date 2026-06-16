import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import { SqlError } from "@effect/sql/SqlError";
import { and, eq, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive, DBNotFoundError } from "../effect-db";
import { approval } from "../schema";
import { effect } from "effect/Layer";

export type Approval = InferSelectModel<typeof approval>;
export type ApprovalType = Approval["type"];
export type ApprovalStatus = Approval["status"];

export type ApprovalDecisionInput = {
  userId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  approvedBy: string | null;
  reason?: string | null;
};

export class ApprovalRepo extends Context.Tag("@repo/db/ApprovalRepo")<
  ApprovalRepo,
  {
    findByUserIdAndType: (userId: string, type: ApprovalType) => Effect.Effect<Approval, SqlError | DBNotFoundError>;
    upsertDecision: (input: ApprovalDecisionInput) => Effect.Effect<Approval, SqlError>;
  }
>() {}

export const ApprovalRepoLive = Layer.effect(
  ApprovalRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      findByUserIdAndType: (userId, type) =>
        db
          .select()
          .from(approval)
          .where(and(eq(approval.userId, userId), eq(approval.type, type)))
          .limit(1)
          .pipe(
            Effect.flatMap(
              (rows) => {
                if (rows[0]) {
                  return Effect.succeed(rows[0])
                }
                return Effect.fail(
                  new DBNotFoundError({ entity: 'approval', value: userId})
                )
              }
            )
          ),
      upsertDecision: (input) =>
        db
          .insert(approval)
          .values({
            userId: input.userId,
            type: input.type,
            status: input.status,
            approvedBy: input.approvedBy,
            reason: input.reason ?? null,
          })
          .onConflictDoUpdate({
            target: [approval.userId, approval.type],
            set: {
              status: input.status,
              approvedBy: input.approvedBy,
              reason: input.reason ?? null,
              updatedAt: new Date(),
            },
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
    };
  }),
);

export const ApprovalRepoDefault = ApprovalRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeApprovalRepoTest = (implementation: Context.Tag.Service<ApprovalRepo>) =>
  Layer.succeed(ApprovalRepo, implementation);

export const EmptyApprovalRepoTest = makeApprovalRepoTest({
  findByUserIdAndType: () => Effect.fail(new DBNotFoundError({ entity: "approval", value: '' })),
  upsertDecision: (_: ApprovalDecisionInput) => Effect.fail(new SqlError({ cause: '', message: ''})),
})