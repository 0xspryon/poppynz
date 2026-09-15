import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import type { SqlError } from '@effect/sql/SqlError';
import { eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
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

/** Statuses under which the money is ours to spend or to give back. */
export const settledPaymentStatuses: Array<PaymentStatus> = ['authorised', 'captured'];

export const isSettledPayment = (record: Pick<Payment, 'status'> | null): boolean =>
  record !== null && settledPaymentStatuses.includes(record.status);

export class PaymentRepo extends Context.Tag('@repo/db/PaymentRepo')<
  PaymentRepo,
  {
    findById: (id: string) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
    create: (input: PaymentCreateInput) => Effect.Effect<Payment, SqlError>;
    update: (
      id: string,
      input: PaymentUpdateInput
    ) => Effect.Effect<Payment, SqlError | DBNotFoundError>;
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
          .pipe(Effect.flatMap(oneOrNotFound(id)))
    };
  })
);

export const PaymentRepoDefault = PaymentRepoLive.pipe(Layer.provide(DrizzleLive));

export const makePaymentRepoTest = (implementation: Context.Tag.Service<PaymentRepo>) =>
  Layer.succeed(PaymentRepo, implementation);

const notFound = () => Effect.fail(new DBNotFoundError({ entity: 'payment', value: '' }));

export const EmptyPaymentRepoTest = makePaymentRepoTest({
  findById: notFound,
  create: () => notFound() as never,
  update: notFound
});
