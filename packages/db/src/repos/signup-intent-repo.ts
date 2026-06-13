import * as PgDrizzle from "@effect/sql-drizzle/Pg";
import type { SqlError } from "@effect/sql/SqlError";
import { and, desc, eq, gt, InferInsertModel, InferSelectModel, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DrizzleLive } from "../effect-db";
import { signupIntent } from "../schema";

export type SignupIntent = InferSelectModel<typeof signupIntent>;
export type NewSignupIntent = InferInsertModel<typeof signupIntent>;

export class SignupIntentRepo extends Context.Tag("@repo/db/SignupIntentRepo")<
  SignupIntentRepo,
  {
    create: (input: {
      email: string;
      role: string;
      language: string;
      expiresAt: Date;
    }) => Effect.Effect<SignupIntent, SqlError>;
    findValidByEmail: (email: string) => Effect.Effect<SignupIntent | null, SqlError>;
    consumeByEmail: (email: string) => Effect.Effect<SignupIntent, SqlError>;
  }
>() { }

export const SignupIntentRepoLive = Layer.effect(
  SignupIntentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      create: (input) =>
        db
          .insert(signupIntent)
          .values({
            id: crypto.randomUUID(),
            email: input.email.toLowerCase(),
            role: input.role,
            language: input.language,
            expiresAt: input.expiresAt,
          })
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
      findValidByEmail: (email) =>
        db
          .select()
          .from(signupIntent)
          .where(
            and(
              eq(signupIntent.email, email.toLowerCase()),
              gt(signupIntent.expiresAt, new Date()),
              isNull(signupIntent.consumedAt),
            ),
          )
          .orderBy(desc(signupIntent.createdAt))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),
      consumeByEmail: (email) =>
        db
          .update(signupIntent)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(signupIntent.email, email.toLowerCase()),
              gt(signupIntent.expiresAt, new Date()),
              isNull(signupIntent.consumedAt),
            ),
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0])),
    };
  }),
);

export const SignupIntentRepoDefault = SignupIntentRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeSignupIntentRepoTest = (implementation: Context.Tag.Service<SignupIntentRepo>) =>
  Layer.succeed(SignupIntentRepo, implementation);
