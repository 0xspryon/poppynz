import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, inArray, type InferSelectModel, isNull } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { serviceNeeded, user, userProfile } from '../schema';

export type FamilySearchProfile = InferSelectModel<typeof userProfile> & {
  email: string;
  role: string | null;
  image: string | null;
  banned: boolean | null;
  banExpires: Date | null;
};

export type FamilySearchService = InferSelectModel<typeof serviceNeeded>;

export type FamilySearchCandidate = {
  profile: FamilySearchProfile;
  services: Array<FamilySearchService>;
};

export class FamilySearchRepo extends Context.Tag('@repo/db/FamilySearchRepo')<
  FamilySearchRepo,
  {
    findCandidateByUserId: (
      userId: string
    ) => Effect.Effect<FamilySearchCandidate, SqlError | DBNotFoundError>;
    listCandidatesByUserIds: (
      userIds: Array<string>
    ) => Effect.Effect<Array<FamilySearchCandidate>, SqlError>;
    listFamilyUserIds: () => Effect.Effect<Array<string>, SqlError>;
  }
>() {}

export const FamilySearchRepoLive = Layer.effect(
  FamilySearchRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const profileSelection = {
      profile: userProfile,
      email: user.email,
      role: user.role,
      image: user.image,
      banned: user.banned,
      banExpires: user.banExpires
    };

    const toProfile = (row: {
      profile: InferSelectModel<typeof userProfile>;
      email: string;
      role: string | null;
      image: string | null;
      banned: boolean | null;
      banExpires: Date | null;
    }): FamilySearchProfile => ({
      ...row.profile,
      email: row.email,
      role: row.role,
      image: row.image,
      banned: row.banned,
      banExpires: row.banExpires
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
            return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
          })
        );

    const listServices = (userId: string) =>
      db
        .select()
        .from(serviceNeeded)
        .where(and(eq(serviceNeeded.userId, userId), isNull(serviceNeeded.deletedAt)));

    const listCandidatesByUserIds = (
      userIds: Array<string>
    ): Effect.Effect<Array<FamilySearchCandidate>, SqlError> => {
      if (userIds.length === 0) return Effect.succeed([]);

      return Effect.all(
        {
          profiles: db
            .select(profileSelection)
            .from(userProfile)
            .innerJoin(user, eq(userProfile.userId, user.id))
            .where(inArray(userProfile.userId, userIds)),
          services: db
            .select()
            .from(serviceNeeded)
            .where(and(inArray(serviceNeeded.userId, userIds), isNull(serviceNeeded.deletedAt)))
        },
        { concurrency: 'unbounded' }
      ).pipe(
        Effect.map(({ profiles, services }) => {
          const servicesByUserId = new Map<string, Array<FamilySearchService>>();
          for (const row of services) {
            const existing = servicesByUserId.get(row.userId);
            if (existing) existing.push(row);
            else servicesByUserId.set(row.userId, [row]);
          }

          return profiles.map((row) => ({
            profile: toProfile(row),
            services: servicesByUserId.get(row.profile.userId) ?? []
          }));
        })
      );
    };

    return {
      findCandidateByUserId: (userId) =>
        Effect.all(
          {
            profile: findProfile(userId),
            services: listServices(userId)
          },
          { concurrency: 'unbounded' }
        ),
      listCandidatesByUserIds,
      listFamilyUserIds: () =>
        db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.role, 'family'))
          .pipe(Effect.map((rows) => rows.map((row) => row.id)))
    };
  })
);

export const FamilySearchRepoDefault = FamilySearchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeFamilySearchRepoTest = (implementation: Context.Tag.Service<FamilySearchRepo>) =>
  Layer.succeed(FamilySearchRepo, implementation);
