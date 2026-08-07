import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { desc, eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { user, userProfile } from '../schema';

/** One row of the admin user directory: the auth user plus profile names.
 * Kept as its own repo (not UserRepo) so the admin listing can grow joins
 * without widening the auth-path repo every test stubs. */
export type DirectoryUser = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  firstName: string | null;
  lastName: string | null;
};

export class UserDirectoryRepo extends Context.Tag('@repo/db/UserDirectoryRepo')<
  UserDirectoryRepo,
  {
    listAll: () => Effect.Effect<Array<DirectoryUser>, SqlError>;
  }
>() {}

export const UserDirectoryRepoLive = Layer.effect(
  UserDirectoryRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      listAll: () =>
        db
          .select({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            banned: user.banned,
            banReason: user.banReason,
            createdAt: user.createdAt,
            firstName: userProfile.firstName,
            lastName: userProfile.lastName
          })
          .from(user)
          .leftJoin(userProfile, eq(userProfile.userId, user.id))
          .orderBy(desc(user.createdAt))
          .pipe(Effect.map((rows) => rows.map((row) => ({ ...row, banned: row.banned ?? false }))))
    };
  })
);

export const UserDirectoryRepoDefault = UserDirectoryRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserDirectoryRepoTest = (implementation: Context.Tag.Service<UserDirectoryRepo>) =>
  Layer.succeed(UserDirectoryRepo, implementation);
