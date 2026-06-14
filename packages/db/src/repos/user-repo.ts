import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { eq, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { user } from "../schema";

export type User = InferSelectModel<typeof user>;

export class UserRepo extends Context.Tag("@repo/db/UserRepo")<
  UserRepo,
  {
    findById: (id: string) => Effect.Effect<User | null, SqlError>;
    findByEmail: (email: string) => Effect.Effect<User | null, SqlError>;
  }
>() {}

export const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      findById: (id) =>
        db
          .select()
          .from(user)
          .where(eq(user.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      findByEmail: (email) =>
        db
          .select()
          .from(user)
          .where(eq(user.email, email.toLowerCase()))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
    };
  }),
);

export const UserRepoDefault = UserRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserRepoTest = (implementation: Context.Tag.Service<UserRepo>) =>
  Layer.succeed(UserRepo, implementation);
