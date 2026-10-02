import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { stripeWebhookEvent } from '../schema';

/**
 * `new`: first delivery of this event. `unprocessed`: seen before but never
 * finished (an earlier attempt failed) — Stripe is retrying, so process it.
 * `processed`: a duplicate of a delivery we already handled — acknowledge it.
 */
export type StripeWebhookRecordResult = 'new' | 'unprocessed' | 'processed';

export class StripeWebhookEventRepo extends Context.Tag('@repo/db/StripeWebhookEventRepo')<
  StripeWebhookEventRepo,
  {
    record: (input: {
      eventId: string;
      type: string;
      objectId: string;
    }) => Effect.Effect<StripeWebhookRecordResult, SqlError>;
    markProcessed: (eventId: string) => Effect.Effect<void, SqlError>;
    markFailed: (eventId: string, error: string) => Effect.Effect<void, SqlError>;
  }
>() {}

export const StripeWebhookEventRepoLive = Layer.effect(
  StripeWebhookEventRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    return {
      record: (input) =>
        Effect.gen(function* () {
          const inserted = yield* db
            .insert(stripeWebhookEvent)
            .values(input)
            .onConflictDoNothing({ target: stripeWebhookEvent.eventId })
            .returning();
          if (inserted.length > 0) return 'new' as const;
          const existing = yield* db
            .select()
            .from(stripeWebhookEvent)
            .where(eq(stripeWebhookEvent.eventId, input.eventId))
            .limit(1);
          return existing[0]?.processedAt ? ('processed' as const) : ('unprocessed' as const);
        }),

      markProcessed: (eventId) =>
        db
          .update(stripeWebhookEvent)
          .set({ processedAt: new Date(), error: null })
          .where(eq(stripeWebhookEvent.eventId, eventId))
          .pipe(Effect.asVoid),

      markFailed: (eventId, error) =>
        db
          .update(stripeWebhookEvent)
          .set({ error: error.slice(0, 2000) })
          .where(eq(stripeWebhookEvent.eventId, eventId))
          .pipe(Effect.asVoid)
    };
  })
);

export const StripeWebhookEventRepoDefault = StripeWebhookEventRepoLive.pipe(
  Layer.provide(DrizzleLive)
);

export const makeStripeWebhookEventRepoTest = (
  implementation: Partial<Context.Tag.Service<StripeWebhookEventRepo>>
) =>
  Layer.succeed(StripeWebhookEventRepo, {
    record: () => Effect.succeed('new' as const),
    markProcessed: () => Effect.void,
    markFailed: () => Effect.void,
    ...implementation
  });
