import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { eq, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { user } from "../schema";

export type User= InferSelectModel<typeof user>
export type NewUser = InferInsertModel<typeof user>

export class UserRepo extends Context.Tag("@repo/db/UserRepo")<
  UserRepo,
  {
    getAnonymousUsers: () => Effect.Effect<ReadonlyArray<User>, SqlError>;
  }
>() {}

export const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      getAnonymousUsers: () =>
        db.select().from(user).where(eq(user.isAnonymous, true)),
    };
  }),
);

export const UserRepoDefault = UserRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserRepoTest = (implementation: Context.Tag.Service<UserRepo>) =>
  Layer.succeed(UserRepo, implementation);
