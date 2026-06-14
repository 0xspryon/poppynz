import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { eq, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { user, userProfile } from "../schema";

export type UserProfile = InferSelectModel<typeof userProfile>;
export type NewUserProfile = InferInsertModel<typeof userProfile>;
export type UserProfileUpdate = Partial<
  Pick<
    UserProfile,
    | "firstName"
    | "lastName"
    | "gender"
    | "phoneNumber"
    | "dateOfBirth"
    | "address"
    | "city"
    | "postalCode"
    | "country"
    | "stateProvince"
    | "shortBio"
  >
>;
export type SafeUserProfile = UserProfile & {
  email: string;
  role: string | null;
};

export class UserProfileRepo extends Context.Tag("@repo/db/UserProfileRepo")<
  UserProfileRepo,
  {
    create: (input: { userId: string; language: string }) => Effect.Effect<UserProfile, SqlError>;
    findByUserId: (userId: string) => Effect.Effect<SafeUserProfile | null, SqlError>;
    updateByUserId: (userId: string, input: UserProfileUpdate) => Effect.Effect<SafeUserProfile | null, SqlError>;
  }
>() {}

export const UserProfileRepoLive = Layer.effect(
  UserProfileRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(userProfile)
          .values({
            userId: input.userId,
            language: input.language,
          })
          .onConflictDoUpdate({
            target: userProfile.userId,
            set: { language: input.language },
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findByUserId: (userId) =>
        db
          .select({ profile: userProfile, email: user.email, role: user.role })
          .from(userProfile)
          .innerJoin(user, eq(userProfile.userId, user.id))
          .where(eq(userProfile.userId, userId))
          .limit(1)
          .pipe(
            Effect.map((rows) => {
              const row = rows[0];

              return row ? { ...row.profile, email: row.email, role: row.role } : null;
            }),
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
                .select({ profile: userProfile, email: user.email, role: user.role })
                .from(userProfile)
                .innerJoin(user, eq(userProfile.userId, user.id))
                .where(eq(userProfile.userId, userId))
                .limit(1),
            ),
            Effect.map((rows) => {
              const row = rows[0];

              return row ? { ...row.profile, email: row.email, role: row.role } : null;
            }),
          ),
    };
  }),
);

export const UserProfileRepoDefault = UserProfileRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserProfileRepoTest = (implementation: Context.Tag.Service<UserProfileRepo>) =>
  Layer.succeed(UserProfileRepo, implementation);
