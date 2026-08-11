import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { count, desc, eq, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { user, userSearch, type UserSearchDetails } from '../schema';

export type UserSearch = InferSelectModel<typeof userSearch>;
export type UserSearchCreateInput = {
  userId: string;
  details: UserSearchDetails;
};
/** A saved search joined with who ran it, for the admin listing. */
export type UserSearchWithUser = UserSearch & {
  userName: string;
  userEmail: string;
};
export type UserSearchPage = {
  searches: Array<UserSearchWithUser>;
  total: number;
};

export class UserSearchRepo extends Context.Tag('@repo/db/UserSearchRepo')<
  UserSearchRepo,
  {
    create: (input: UserSearchCreateInput) => Effect.Effect<UserSearch, SqlError>;
    listPaginated: (page: number, perPage: number) => Effect.Effect<UserSearchPage, SqlError>;
  }
>() {}

export const UserSearchRepoLive = Layer.effect(
  UserSearchRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(userSearch)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      listPaginated: (page, perPage) =>
        Effect.all(
          [
            db
              .select({
                id: userSearch.id,
                userId: userSearch.userId,
                details: userSearch.details,
                createdAt: userSearch.createdAt,
                userName: user.name,
                userEmail: user.email
              })
              .from(userSearch)
              .innerJoin(user, eq(userSearch.userId, user.id))
              // uuidv7 ids are time-ordered — a stable tiebreak for rows
              // created within the same timestamp.
              .orderBy(desc(userSearch.createdAt), desc(userSearch.id))
              .limit(perPage)
              .offset((page - 1) * perPage),
            db.select({ total: count() }).from(userSearch)
          ],
          { concurrency: 2 }
        ).pipe(
          Effect.map(([searches, totals]) => ({
            searches,
            total: totals[0]?.total ?? 0
          }))
        )
    };
  })
);

export const UserSearchRepoDefault = UserSearchRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeUserSearchRepoTest = (implementation: Context.Tag.Service<UserSearchRepo>) =>
  Layer.succeed(UserSearchRepo, implementation);
