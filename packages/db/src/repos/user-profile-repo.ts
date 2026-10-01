import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import { SqlError } from '@effect/sql/SqlError';
import { eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive, DBNotFoundError } from '../effect-db';
import { user, userProfile } from '../schema';

export type UserProfile = InferSelectModel<typeof userProfile>;
export type NewUserProfile = InferInsertModel<typeof userProfile>;
export type UserProfileUpdate = Partial<
  Pick<
    UserProfile,
    | 'firstName'
    | 'lastName'
    | 'gender'
    | 'phoneNumber'
    | 'dateOfBirth'
    | 'address'
    | 'city'
    | 'postalCode'
    | 'country'
    | 'stateProvince'
    | 'shortBio'
  >
>;
export type UserProfileLocationUpdate = Pick<
  UserProfile,
  'googlePlaceId' | 'latitude' | 'longitude'
> &
  Partial<Pick<UserProfile, 'address' | 'city' | 'postalCode' | 'country' | 'stateProvince'>>;
export type SafeUserProfile = UserProfile & {
  email: string;
  role: string | null;
  image: string | null;
};

export class UserProfileRepo extends Context.Tag('@repo/db/UserProfileRepo')<
  UserProfileRepo,
  {
    create: (input: { userId: string; language: string }) => Effect.Effect<UserProfile, SqlError>;
    findByUserId: (userId: string) => Effect.Effect<SafeUserProfile, SqlError | DBNotFoundError>;
    updateByUserId: (
      userId: string,
      input: UserProfileUpdate
    ) => Effect.Effect<SafeUserProfile, SqlError | DBNotFoundError>;
    updateLocationByUserId: (
      userId: string,
      input: UserProfileLocationUpdate
    ) => Effect.Effect<SafeUserProfile, SqlError | DBNotFoundError>;
    /** Sets the storage key of the user's profile photo (`user.image`). */
    updateImageByUserId: (
      userId: string,
      imageKey: string | null
    ) => Effect.Effect<SafeUserProfile, SqlError | DBNotFoundError>;
  }
>() {}

export const UserProfileRepoLive = Layer.effect(
  UserProfileRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const findSafeProfile = (userId: string) =>
      db
        .select({ profile: userProfile, email: user.email, role: user.role, image: user.image })
        .from(userProfile)
        .innerJoin(user, eq(userProfile.userId, user.id))
        .where(eq(userProfile.userId, userId))
        .limit(1)
        .pipe(
          Effect.flatMap((rows) => {
            const row = rows[0];

            if (row) {
              return Effect.succeed({
                ...row.profile,
                email: row.email,
                role: row.role,
                image: row.image
              });
            }
            return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
          })
        );

    return {
      create: (input) =>
        db
          .insert(userProfile)
          .values({
            userId: input.userId,
            language: input.language
          })
          .onConflictDoUpdate({
            target: userProfile.userId,
            set: { language: input.language }
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findByUserId: (userId) =>
        db
          .select({ profile: userProfile, email: user.email, role: user.role, image: user.image })
          .from(userProfile)
          .innerJoin(user, eq(userProfile.userId, user.id))
          .where(eq(userProfile.userId, userId))
          .limit(1)
          .pipe(
            Effect.flatMap((rows) => {
              const row = rows[0];

              if (row) {
                return Effect.succeed({
                  ...row.profile,
                  email: row.email,
                  role: row.role,
                  image: row.image
                });
              }
              return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
            })
          ),
      updateByUserId: (userId, input) =>
        db
          .update(userProfile)
          .set(input)
          .where(eq(userProfile.userId, userId))
          .returning()
          .pipe(
            Effect.flatMap(() =>
              db
                .select({
                  profile: userProfile,
                  email: user.email,
                  role: user.role,
                  image: user.image
                })
                .from(userProfile)
                .innerJoin(user, eq(userProfile.userId, user.id))
                .where(eq(userProfile.userId, userId))
                .limit(1)
            ),
            Effect.flatMap((rows) => {
              const row = rows[0];

              if (row) {
                return Effect.succeed({
                  ...row.profile,
                  email: row.email,
                  role: row.role,
                  image: row.image
                });
              }
              return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
            })
          ),
      updateLocationByUserId: (userId, input) =>
        db
          .update(userProfile)
          .set(input)
          .where(eq(userProfile.userId, userId))
          .returning()
          .pipe(
            Effect.flatMap(() =>
              db
                .select({
                  profile: userProfile,
                  email: user.email,
                  role: user.role,
                  image: user.image
                })
                .from(userProfile)
                .innerJoin(user, eq(userProfile.userId, user.id))
                .where(eq(userProfile.userId, userId))
                .limit(1)
            ),
            Effect.flatMap((rows) => {
              const row = rows[0];

              if (row) {
                return Effect.succeed({
                  ...row.profile,
                  email: row.email,
                  role: row.role,
                  image: row.image
                });
              }
              return Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: userId }));
            })
          ),
      updateImageByUserId: (userId, imageKey) =>
        db
          .update(user)
          .set({ image: imageKey })
          .where(eq(user.id, userId))
          .pipe(Effect.flatMap(() => findSafeProfile(userId)))
    };
  })
);

export const UserProfileRepoDefault = UserProfileRepoLive.pipe(Layer.provide(DrizzleLive));

type UserProfileRepoService = Context.Tag.Service<UserProfileRepo>;

// `updateImageByUserId` is optional so suites written before profile photos
// existed keep compiling; it fails like a missing row unless a test supplies it.
export const makeUserProfileRepoTest = (
  implementation: Omit<UserProfileRepoService, 'updateImageByUserId'> &
    Partial<Pick<UserProfileRepoService, 'updateImageByUserId'>>
) =>
  Layer.succeed(UserProfileRepo, {
    updateImageByUserId: () =>
      Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: '' })),
    ...implementation
  });

export const EmptyUserProfileRepoTest = makeUserProfileRepoTest({
  create: () => Effect.fail(new SqlError({ cause: '', message: '' })),
  findByUserId: () => Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: '' })),
  updateByUserId: () => Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: '' })),
  updateLocationByUserId: () =>
    Effect.fail(new DBNotFoundError({ entity: 'userProfile', value: '' }))
});
