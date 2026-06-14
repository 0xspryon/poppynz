import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { eq, InferSelectModel } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { session } from "../schema";

export type Session = InferSelectModel<typeof session>;

export class SessionRepo extends Context.Tag("@repo/db/SessionRepo")<
  SessionRepo,
  {
    findById: (id: string) => Effect.Effect<Session | null, SqlError>;
  }
>() {}

export const SessionRepoLive = Layer.effect(
  SessionRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      findById: (id) =>
        db
          .select()
          .from(session)
          .where(eq(session.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
    };
  }),
);

export const SessionRepoDefault = SessionRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeSessionRepoTest = (implementation: Context.Tag.Service<SessionRepo>) =>
  Layer.succeed(SessionRepo, implementation);
