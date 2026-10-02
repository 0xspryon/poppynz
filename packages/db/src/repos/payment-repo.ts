import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { payment } from '../schema';

export type Payment = InferSelectModel<typeof payment>;
export type PaymentInsert = InferInsertModel<typeof payment>;
export type PaymentStatus = Payment['status'];
export type PaymentKind = Payment['kind'];

/** A row is created `pending`, before the provider is asked for money, so the
 * breakdown and the purpose are the only things the caller decides. */
export type PaymentCreateInput = Pick<
  PaymentInsert,
  'userId' | 'kind' | 'provider' | 'amountCents' | 'feeCents' | 'taxCents' | 'totalCents'
> &
  Partial<Pick<PaymentInsert, 'currency'>>;

export type PaymentUpdateInput = Partial<
  Omit<Payment, 'id' | 'userId' | 'kind' | 'createdAt' | 'updatedAt'>
>;

/** A guarded transition: `set` lands only if the row is still in one of the
 * `from` statuses. Null means it had already moved — the caller lost a race
 * and must not assume its write happened. */
export type PaymentAdvanceInput = {
  from: PaymentStatus | ReadonlyArray<PaymentStatus>;
  /** Also guards the provider reference when given: null means "no intent
   * recorded yet". How a start records its intent without overwriting one a
   * concurrent request already handed to the browser. */
  providerReference?: string | null;
  set: PaymentUpdateInput;
};

/** A row of the payer's history, with what it was for. */
export type PaymentHistoryItem = Payment & { description: string };

/** Statuses under which the money is ours to spend or to give back. */
export const settledPaymentStatuses: Array<PaymentStatus> = ['authorised', 'captured'];

export const isSettledPayment = (record: Pick<Payment, 'status'> | null): boolean =>
  record !== null && settledPaymentStatuses.includes(record.status);

/** What each kind of charge is called in the payer's history. */
export const paymentKindDescriptions: Record<PaymentKind, string> = {
  credibled_order: 'Background check'
};

export class PaymentRepo extends Context.Tag('@repo/db/PaymentRepo')<
  PaymentRepo,
  {
    findById: (id: string) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
    /** How an inbound provider event finds its row. */
    findByProviderReference: (
      provider: string,
      reference: string
    ) => Effect.Effect<Payment | null, SqlError>;
    /** The payer's history, newest first. Rows that never reached the
     * provider (a lost claim race) are not history and are left out. */
    listByUser: (userId: string) => Effect.Effect<Array<PaymentHistoryItem>, SqlError>;
    /** Charges still waiting on `provider` that were started before
     * `createdBefore` — the recovery job's work list. */
    listStalePending: (
      provider: string,
      createdBefore: Date
    ) => Effect.Effect<Array<Payment>, SqlError>;
    create: (input: PaymentCreateInput) => Effect.Effect<Payment, SqlError>;
    /** For fields that carry no state (references, error notes). Status
     * changes that race something else go through `advance`. */
    update: (
      id: string,
      input: PaymentUpdateInput
    ) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
    /** Compare-and-set on status: the browser, the webhook and the recovery
     * job may all settle the same payment, and each outcome must be applied
     * exactly once. */
    advance: (id: string, input: PaymentAdvanceInput) => Effect.Effect<Payment | null, SqlError>;
  }
>() {}

export const PaymentRepoLive = Layer.effect(
  PaymentRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const oneOrNotFound = (id: string) => (rows: Array<Payment>) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id }));

    return {
      findById: (id) =>
        db
          .select()
          .from(payment)
          .where(eq(payment.id, id))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      findByProviderReference: (provider, reference) =>
        db
          .select()
          .from(payment)
          .where(and(eq(payment.provider, provider), eq(payment.providerReference, reference)))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0] ?? null)),

      listByUser: (userId) =>
        db
          .select()
          .from(payment)
          .where(and(eq(payment.userId, userId), isNotNull(payment.providerReference)))
          .orderBy(desc(payment.createdAt))
          .pipe(
            Effect.map((rows) =>
              rows.map((row) => ({ ...row, description: paymentKindDescriptions[row.kind] }))
            )
          ),

      listStalePending: (provider, createdBefore) =>
        db
          .select()
          .from(payment)
          .where(
            and(
              eq(payment.status, 'pending'),
              eq(payment.provider, provider),
              isNotNull(payment.providerReference),
              lt(payment.createdAt, createdBefore)
            )
          )
          .orderBy(payment.createdAt),

      create: (input) =>
        db
          .insert(payment)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),

      update: (id, input) =>
        db
          .update(payment)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(payment.id, id))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      advance: (id, input) => {
        const statuses: Array<PaymentStatus> = Array.isArray(input.from)
          ? [...(input.from as ReadonlyArray<PaymentStatus>)]
          : [input.from as PaymentStatus];
        return db
          .update(payment)
          .set({ ...input.set, updatedAt: new Date() })
          .where(
            and(
              eq(payment.id, id),
              inArray(payment.status, statuses),
              input.providerReference === undefined
                ? undefined
                : input.providerReference === null
                  ? isNull(payment.providerReference)
                  : eq(payment.providerReference, input.providerReference)
            )
          )
          .returning()
          .pipe(Effect.map((rows) => rows[0] ?? null));
      }
    };
  })
);

export const PaymentRepoDefault = PaymentRepoLive.pipe(Layer.provide(DrizzleLive));

const notFound = () => Effect.fail(new DBNotFoundError({ entity: 'payment', value: '' }));

const emptyPaymentRepo: Context.Tag.Service<PaymentRepo> = {
  findById: notFound,
  findByProviderReference: () => Effect.succeed(null),
  listByUser: () => Effect.succeed([]),
  listStalePending: () => Effect.succeed([]),
  create: () => notFound() as never,
  update: notFound,
  advance: () => Effect.succeed(null)
};

/** Unspecified methods behave like an empty table. */
export const makePaymentRepoTest = (implementation: Partial<Context.Tag.Service<PaymentRepo>>) =>
  Layer.succeed(PaymentRepo, { ...emptyPaymentRepo, ...implementation });

export const EmptyPaymentRepoTest = makePaymentRepoTest({});
