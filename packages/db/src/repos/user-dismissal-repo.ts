import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { userDismissal } from '../schema';

/** One-off prompts a user has closed (UAT #16). */
export class UserDismissalRepo extends Context.Tag('@repo/db/UserDismissalRepo')<
  UserDismissalRepo,
  {
    listKeys: (userId: string) => Effect.Effect<Array<string>, SqlError>;
    /** Idempotent: dismissing twice keeps the first time. */
    dismiss: (userId: string, key: string) => Effect.Effect<void, SqlError>;
  }
>() {}

export const UserDismissalRepoLive = Layer.effect(
  UserDismissalRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    return {
      listKeys: (userId) =>
        db
          .select({ key: userDismissal.key })
          .from(userDismissal)
          .where(eq(userDismissal.userId, userId))
          .pipe(Effect.map((rows) => rows.map((row) => row.key))),
      dismiss: (userId, key) =>
        db
          .insert(userDismissal)
          .values({ userId, key })
          .onConflictDoNothing()
          .pipe(Effect.asVoid)
    };
  })
);

export const UserDismissalRepoDefault = UserDismissalRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserDismissalRepoTest = (
  implementation: Context.Tag.Service<UserDismissalRepo>
) => Layer.succeed(UserDismissalRepo, implementation);

/** An in-memory repo for tests: dismissals live in the returned set. */
export const makeInMemoryUserDismissalRepo = (initial: Array<string> = []) => {
  const keys = new Set(initial);
  return {
    keys,
    layer: makeUserDismissalRepoTest({
      listKeys: (userId) =>
        Effect.succeed(
          [...keys].filter((entry) => entry.startsWith(`${userId}:`)).map((entry) => entry.slice(userId.length + 1))
        ),
      dismiss: (userId, key) => Effect.sync(() => void keys.add(`${userId}:${key}`))
    })
  };
};

export const EmptyUserDismissalRepoTest = makeUserDismissalRepoTest({
  listKeys: () => Effect.succeed([]),
  dismiss: () => Effect.void
});
