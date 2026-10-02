import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { and, eq, sql, type InferSelectModel } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DrizzleLive } from '../effect-db';
import { billingCustomer } from '../schema';

export type BillingCustomer = InferSelectModel<typeof billingCustomer>;

/** Display details of the card on file, plus the gateway's reference for it. */
export type BillingCard = {
  reference: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export class BillingCustomerRepo extends Context.Tag('@repo/db/BillingCustomerRepo')<
  BillingCustomerRepo,
  {
    findByUserId: (userId: string) => Effect.Effect<BillingCustomer | null, SqlError>;
    /** How a gateway event (a SetupIntent, a PaymentIntent's customer) finds
     * the user it belongs to. */
    findByCustomerReference: (
      provider: string,
      customerReference: string
    ) => Effect.Effect<BillingCustomer | null, SqlError>;
    /** Records the gateway customer for a user. One customer per user per
     * gateway: an existing row for the same gateway is returned untouched (a
     * racing second create is a no-op); a row from ANOTHER gateway (mock →
     * stripe) is replaced and its card forgotten. */
    upsertCustomer: (input: {
      userId: string;
      provider: string;
      customerReference: string;
    }) => Effect.Effect<BillingCustomer, SqlError>;
    /** Null when the user has no customer row. */
    setCard: (userId: string, card: BillingCard) => Effect.Effect<BillingCustomer | null, SqlError>;
    clearCard: (userId: string) => Effect.Effect<BillingCustomer | null, SqlError>;
  }
>() {}

const firstOrNull = (rows: Array<BillingCustomer>) => rows[0] ?? null;

export const BillingCustomerRepoLive = Layer.effect(
  BillingCustomerRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;

    const findByUserId = (userId: string) =>
      db
        .select()
        .from(billingCustomer)
        .where(eq(billingCustomer.userId, userId))
        .limit(1)
        .pipe(Effect.map(firstOrNull));

    return {
      findByUserId,

      findByCustomerReference: (provider, customerReference) =>
        db
          .select()
          .from(billingCustomer)
          .where(
            and(
              eq(billingCustomer.provider, provider),
              eq(billingCustomer.customerReference, customerReference)
            )
          )
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      upsertCustomer: (input) =>
        Effect.gen(function* () {
          const written = yield* db
            .insert(billingCustomer)
            .values(input)
            .onConflictDoUpdate({
              target: billingCustomer.userId,
              set: {
                provider: input.provider,
                customerReference: input.customerReference,
                cardReference: null,
                cardBrand: null,
                cardLast4: null,
                cardExpMonth: null,
                cardExpYear: null,
                updatedAt: new Date()
              },
              setWhere: sql`${billingCustomer.provider} <> ${input.provider}`
            })
            .returning();
          if (written[0]) return written[0];
          // Same gateway already on file: keep it.
          const existing = yield* findByUserId(input.userId);
          return existing!;
        }),

      setCard: (userId, card) =>
        db
          .update(billingCustomer)
          .set({
            cardReference: card.reference,
            cardBrand: card.brand,
            cardLast4: card.last4,
            cardExpMonth: card.expMonth,
            cardExpYear: card.expYear,
            updatedAt: new Date()
          })
          .where(eq(billingCustomer.userId, userId))
          .returning()
          .pipe(Effect.map(firstOrNull)),

      clearCard: (userId) =>
        db
          .update(billingCustomer)
          .set({
            cardReference: null,
            cardBrand: null,
            cardLast4: null,
            cardExpMonth: null,
            cardExpYear: null,
            updatedAt: new Date()
          })
          .where(eq(billingCustomer.userId, userId))
          .returning()
          .pipe(Effect.map(firstOrNull))
    };
  })
);

export const BillingCustomerRepoDefault = BillingCustomerRepoLive.pipe(Layer.provide(DrizzleLive));

/** In-memory stand-in with the live repo's semantics, for unit tests. */
export const makeInMemoryBillingCustomerRepo = (
  initial: Array<BillingCustomer> = []
): {
  layer: Layer.Layer<BillingCustomerRepo>;
  rows: Map<string, BillingCustomer>;
} => {
  const rows = new Map(initial.map((row) => [row.userId, row]));
  const cardless = {
    cardReference: null,
    cardBrand: null,
    cardLast4: null,
    cardExpMonth: null,
    cardExpYear: null
  };
  const update = (userId: string, patch: Partial<BillingCustomer>) => {
    const row = rows.get(userId);
    if (!row) return null;
    const next = { ...row, ...patch, updatedAt: new Date() };
    rows.set(userId, next);
    return next;
  };
  return {
    rows,
    layer: Layer.succeed(BillingCustomerRepo, {
      findByUserId: (userId) => Effect.succeed(rows.get(userId) ?? null),
      findByCustomerReference: (provider, customerReference) =>
        Effect.succeed(
          [...rows.values()].find(
            (row) => row.provider === provider && row.customerReference === customerReference
          ) ?? null
        ),
      upsertCustomer: (input) =>
        Effect.sync(() => {
          const existing = rows.get(input.userId);
          if (existing && existing.provider === input.provider) return existing;
          const row: BillingCustomer = {
            ...input,
            ...cardless,
            createdAt: existing?.createdAt ?? new Date(),
            updatedAt: new Date()
          };
          rows.set(input.userId, row);
          return row;
        }),
      setCard: (userId, card) =>
        Effect.sync(() =>
          update(userId, {
            cardReference: card.reference,
            cardBrand: card.brand,
            cardLast4: card.last4,
            cardExpMonth: card.expMonth,
            cardExpYear: card.expYear
          })
        ),
      clearCard: (userId) => Effect.sync(() => update(userId, cardless))
    })
  };
};

/** A row with a card, for fixtures. */
export const dummyBillingCustomer = (
  overrides: Partial<BillingCustomer> = {}
): BillingCustomer => ({
  userId: 'family-1',
  provider: 'mock',
  customerReference: 'mock_cus_family-1',
  cardReference: 'mock_pm_saved',
  cardBrand: 'visa',
  cardLast4: '4242',
  cardExpMonth: 12,
  cardExpYear: 2034,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  ...overrides
});
