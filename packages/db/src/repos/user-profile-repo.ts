import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { userProfile } from "../schema";

export type UserProfile = InferSelectModel<typeof userProfile>;
export type NewUserProfile = InferInsertModel<typeof userProfile>;

export class UserProfileRepo extends Context.Tag("@repo/db/UserProfileRepo")<
  UserProfileRepo,
  {
    create: (input: { userId: string; language: string }) => Effect.Effect<UserProfile, SqlError>;
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
    };
  }),
);

export const UserProfileRepoDefault = UserProfileRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserProfileRepoTest = (implementation: Context.Tag.Service<UserProfileRepo>) =>
  Layer.succeed(UserProfileRepo, implementation);
