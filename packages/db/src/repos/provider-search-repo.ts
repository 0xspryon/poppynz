import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, desc, eq, gt, inArray, type InferSelectModel, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DBNotFoundError, DrizzleLive } from "../effect-db";
import { approval, serviceOffered, user, userProfile } from "../schema";

export type ProviderSearchProfile = InferSelectModel<typeof userProfile> & {
  email: string;
  role: string | null;
  image: string | null;
  banned: boolean | null;
  banExpires: Date | null;
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
    listCandidatesByUserIds: (userIds: Array<string>) => Effect.Effect<Array<ProviderSearchCandidate>, SqlError>;
    listServiceProviderUserIds: () => Effect.Effect<Array<string>, SqlError>;
  }
>() { }

export const ProviderSearchRepoLive = Layer.effect(
  ProviderSearchRepo,
  Effect.gen(function*() {
    const db = yield* PgDrizzle.PgDrizzle;

    const profileSelection = {
      profile: userProfile,
      email: user.email,
      role: user.role,
      image: user.image,
      banned: user.banned,
      banExpires: user.banExpires,
    };

    const toProfile = (row: { profile: InferSelectModel<typeof userProfile>; email: string; role: string | null; image: string | null; banned: boolean | null; banExpires: Date | null }): ProviderSearchProfile => ({
      ...row.profile,
      email: row.email,
      role: row.role,
      image: row.image,
      banned: row.banned,
      banExpires: row.banExpires,
    });

    const findProfile = (userId: string) =>
      db
        .select(profileSelection)
        .from(userProfile)
        .innerJoin(user, eq(userProfile.userId, user.id))
        .where(eq(userProfile.userId, userId))
        .limit(1)
        .pipe(
          Effect.flatMap((rows) => {
            const row = rows[0];
            if (row) return Effect.succeed(toProfile(row));
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

    const listCandidatesByUserIds = (userIds: Array<string>): Effect.Effect<Array<ProviderSearchCandidate>, SqlError> => {
      if (userIds.length === 0) return Effect.succeed([]);

      return Effect.all(
        {
          profiles: db
            .select(profileSelection)
            .from(userProfile)
            .innerJoin(user, eq(userProfile.userId, user.id))
            .where(inArray(userProfile.userId, userIds)),
          approvals: db
            .select()
            .from(approval)
            .where(and(inArray(approval.userId, userIds), eq(approval.status, "approved"), gt(approval.expiresAt, sql`now()`)))
            .orderBy(desc(approval.expiresAt)),
          services: db
            .select()
            .from(serviceOffered)
            .where(and(inArray(serviceOffered.userId, userIds), isNull(serviceOffered.deletedAt))),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(({ profiles, approvals, services }) => {
          // Rows arrive expiresAt-desc, so the first row per user is the current approval.
          const approvalByUserId = new Map<string, ProviderSearchApproval>();
          for (const row of approvals) {
            if (!approvalByUserId.has(row.userId)) approvalByUserId.set(row.userId, row);
          }

          const servicesByUserId = new Map<string, Array<ProviderSearchService>>();
          for (const row of services) {
            const existing = servicesByUserId.get(row.userId);
            if (existing) existing.push(row);
            else servicesByUserId.set(row.userId, [row]);
          }

          return profiles.map((row) => ({
            profile: toProfile(row),
            approval: approvalByUserId.get(row.profile.userId) ?? null,
            services: servicesByUserId.get(row.profile.userId) ?? [],
          }));
        }),
      );
    };

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
      listCandidatesByUserIds,
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
