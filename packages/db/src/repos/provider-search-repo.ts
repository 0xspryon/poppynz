import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, desc, eq, gt, InferSelectModel, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { approval, serviceOffered, user, userProfile } from "../schema";

export type ProviderSearchProfile = InferSelectModel<typeof userProfile> & {
  email: string;
  role: string | null;
};

export type ProviderSearchApproval = InferSelectModel<typeof approval>;
export type ProviderSearchService = InferSelectModel<typeof serviceOffered>;

export type ProviderSearchCandidate = {
  profile: ProviderSearchProfile;
  approval: ProviderSearchApproval | null;
  services: Array<ProviderSearchService>;
};

export class ProviderSearchRepo extends Context.Tag("@repo/db/ProviderSearchRepo")<
  ProviderSearchRepo,
  {
    findCandidateByUserId: (userId: string) => Effect.Effect<ProviderSearchCandidate, SqlError | DBNotFoundError>;
    listServiceProviderUserIds: () => Effect.Effect<Array<string>, SqlError>;
  }
>() { }

export const ProviderSearchRepoLive = Layer.effect(
  ProviderSearchRepo,
  Effect.gen(function*() {
    const db = yield* PgDrizzle.PgDrizzle;

    const findProfile = (userId: string) =>
      db
        .select({ profile: userProfile, email: user.email, role: user.role })
        .from(userProfile)
        .innerJoin(user, eq(userProfile.userId, user.id))
        .where(eq(userProfile.userId, userId))
        .limit(1)
        .pipe(
          Effect.flatMap((rows) => {
            const row = rows[0];
            if (row) return Effect.succeed({ ...row.profile, email: row.email, role: row.role });
            return Effect.fail(new DBNotFoundError({ entity: "userProfile", value: userId }));
          }),
        );

    const findCurrentApproval = (userId: string) =>
      db
        .select()
        .from(approval)
        .where(and(eq(approval.userId, userId), eq(approval.status, "approved"), gt(approval.expiresAt, sql`now()`)))
        .orderBy(desc(approval.expiresAt))
        .limit(1)
        .pipe(Effect.map((rows) => rows[0] ?? null));

    const listServices = (userId: string) =>
      db
        .select()
        .from(serviceOffered)
        .where(and(eq(serviceOffered.userId, userId), isNull(serviceOffered.deletedAt)));

    return {
      findCandidateByUserId: (userId) =>
        Effect.all(
          {
            profile: findProfile(userId),
            approval: findCurrentApproval(userId),
            services: listServices(userId),
          },
          { concurrency: "unbounded" },
        ),
      listServiceProviderUserIds: () =>
        db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.role, "service-provider"))
          .pipe(Effect.map((rows) => rows.map((row) => row.id))),
    };
  }),
);

export const ProviderSearchRepoDefault = ProviderSearchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeProviderSearchRepoTest = (implementation: Context.Tag.Service<ProviderSearchRepo>) =>
  Layer.succeed(ProviderSearchRepo, implementation);
