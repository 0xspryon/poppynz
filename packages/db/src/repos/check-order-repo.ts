import * as PgDrizzle from '@effect/sql-drizzle/Pg';
import * as SqlClient from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type InferInsertModel,
  type InferSelectModel
} from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { DBNotFoundError, DrizzleLive } from '../effect-db';
import { checkOrder, checkOrderItem, kycDocument, safetyVerification } from '../schema';
import type { SafetyVerification, SafetyVerificationInsert } from './safety-verification-repo';

export type CheckOrder = InferSelectModel<typeof checkOrder>;
export type CheckOrderInsert = InferInsertModel<typeof checkOrder>;
export type CheckOrderStatus = CheckOrder['status'];
export type CheckOrderRole = CheckOrder['role'];

export type CheckOrderItem = InferSelectModel<typeof checkOrderItem>;
export type CheckOrderItemInsert = InferInsertModel<typeof checkOrderItem>;
export type CheckOrderItemCreateInput = Pick<
  CheckOrderItemInsert,
  'orderId' | 'documentTypeId' | 'credibledCheckTypeValue' | 'costCents'
>;

export type CheckOrderCreateInput = Pick<CheckOrderInsert, 'userId' | 'role'> &
  Partial<Pick<CheckOrderInsert, 'status' | 'consentAt' | 'consentPolicyVersion'>>;

export type CheckOrderUpdateInput = Partial<
  Omit<CheckOrder, 'id' | 'userId' | 'role' | 'createdAt' | 'updatedAt'>
>;

/** Claiming an order for a charge is a compare-and-set: the caller names the
 * state it saw, and the claim only lands if nothing has moved since. */
export type CheckOrderClaimInput = {
  paymentId: string;
  from: { status: CheckOrderStatus; paymentId: string | null };
};

/** A guarded transition: `set` is applied only if the row is still in one of
 * the `from` states (and, when given, still carries that payment). Null means
 * it had already moved — the caller lost a race and must not assume its
 * write happened. */
export type CheckOrderAdvanceInput = {
  from: { status: CheckOrderStatus | ReadonlyArray<CheckOrderStatus>; paymentId?: string | null };
  set: CheckOrderUpdateInput;
};

/** Everything completion writes, atomically: the order closes and the
 * verdict it produced is created in review_required. */
export type CheckOrderCompletionInput = {
  completedAt: Date;
  verification: Pick<
    SafetyVerificationInsert,
    'consentAt' | 'consentPolicyVersion' | 'issuedOn' | 'expiresOn'
  >;
};

/** Statuses that occupy the single open slot per (user, role). */
export const openCheckOrderStatuses: Array<CheckOrderStatus> = [
  'draft',
  'payment_pending',
  'paid',
  'invited',
  'in_progress'
];

/** Placed with Credibled and not yet finished — the reconcile poller's set. */
export const inFlightCheckOrderStatuses: Array<CheckOrderStatus> = ['invited', 'in_progress'];

export class CheckOrderRepo extends Context.Tag('@repo/db/CheckOrderRepo')<
  CheckOrderRepo,
  {
    findById: (id: string) => Effect.Effect<CheckOrder, SqlError | DBNotFoundError>;
    /** The one order occupying the open slot for this applicant and role, if
     * any. Finished orders are history and never returned here. */
    findOpen: (userId: string, role: CheckOrderRole) => Effect.Effect<CheckOrder | null, SqlError>;
    /** Correlation for inbound Credibled webhooks — their payload carries no
     * external reference, so their uuid is the only key we have. */
    findByCredibledUuid: (uuid: string) => Effect.Effect<CheckOrder | null, SqlError>;
    create: (input: CheckOrderCreateInput) => Effect.Effect<CheckOrder, SqlError>;
    update: (
      id: string,
      input: CheckOrderUpdateInput
    ) => Effect.Effect<CheckOrder, SqlError | DBNotFoundError>;
    /** Moves an order into `payment_pending` with a payment attached, only if
     * it is still exactly as the caller last saw it. Null means somebody else
     * got there first — two concurrent order requests can never both charge. */
    claimForPayment: (
      id: string,
      input: CheckOrderClaimInput
    ) => Effect.Effect<CheckOrder | null, SqlError>;
    /** Compare-and-set for every state change that races something else: a
     * decline's revert against a re-claim, marking paid against a revert, a
     * vendor transition against a concurrent completion. Plain `update` is
     * for fields that carry no state (attempt counters, error notes). */
    advance: (
      id: string,
      input: CheckOrderAdvanceInput
    ) => Effect.Effect<CheckOrder | null, SqlError>;
    /** Closes an in-flight order, creates the verdict it produced, and records
     * each fetched check as a document — in one transaction. Null means the
     * order was not in flight (a duplicate webhook, or a poll racing a
     * delivery) and nothing was written. */
    complete: (
      id: string,
      input: CheckOrderCompletionInput
    ) => Effect.Effect<{ order: CheckOrder; verification: SafetyVerification } | null, SqlError>;
    /** Orders Credibled still owns. The reconcile poller walks these because a
     * dropped webhook is never redelivered. */
    listInFlight: () => Effect.Effect<Array<CheckOrder>, SqlError>;
    /** Paid for but not yet placed — recovered on worker boot in case the
     * queue job was lost between the charge and the order. */
    listAwaitingPlacement: () => Effect.Effect<Array<CheckOrder>, SqlError>;

    /** The basket: which Credibled checks this order will place. */
    listItems: (orderId: string) => Effect.Effect<Array<CheckOrderItem>, SqlError>;
    addItem: (input: CheckOrderItemCreateInput) => Effect.Effect<CheckOrderItem, SqlError>;
    removeItem: (
      orderId: string,
      itemId: string
    ) => Effect.Effect<CheckOrderItem, SqlError | DBNotFoundError>;
  }
>() {}

export const CheckOrderRepoLive = Layer.effect(
  CheckOrderRepo,
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle;
    const sqlClient = yield* SqlClient.SqlClient;

    const oneOrNotFound = (id: string) => (rows: Array<CheckOrder>) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: id }));
    const firstOrNull = (rows: Array<CheckOrder>) => rows[0] ?? null;

    return {
      findById: (id) =>
        db
          .select()
          .from(checkOrder)
          .where(and(eq(checkOrder.id, id), isNull(checkOrder.deletedAt)))
          .limit(1)
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      findOpen: (userId, role) =>
        db
          .select()
          .from(checkOrder)
          .where(
            and(
              eq(checkOrder.userId, userId),
              eq(checkOrder.role, role),
              isNull(checkOrder.deletedAt),
              inArray(checkOrder.status, openCheckOrderStatuses)
            )
          )
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      findByCredibledUuid: (uuid) =>
        db
          .select()
          .from(checkOrder)
          .where(and(eq(checkOrder.credibledCheckUuid, uuid), isNull(checkOrder.deletedAt)))
          .limit(1)
          .pipe(Effect.map(firstOrNull)),

      create: (input) =>
        db
          .insert(checkOrder)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),

      update: (id, input) =>
        db
          .update(checkOrder)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(checkOrder.id, id), isNull(checkOrder.deletedAt)))
          .returning()
          .pipe(Effect.flatMap(oneOrNotFound(id))),

      claimForPayment: (id, input) =>
        db
          .update(checkOrder)
          .set({ status: 'payment_pending', paymentId: input.paymentId, updatedAt: new Date() })
          .where(
            and(
              eq(checkOrder.id, id),
              isNull(checkOrder.deletedAt),
              eq(checkOrder.status, input.from.status),
              // `is not distinct from` so a null expectation matches a null
              // column — plain `=` would never match and the claim would
              // silently fail for every draft.
              sql`${checkOrder.paymentId} is not distinct from ${input.from.paymentId}`
            )
          )
          .returning()
          .pipe(Effect.map(firstOrNull)),

      advance: (id, input) => {
        const statuses = Array.isArray(input.from.status)
          ? (input.from.status as ReadonlyArray<CheckOrderStatus>)
          : [input.from.status as CheckOrderStatus];
        return db
          .update(checkOrder)
          .set({ ...input.set, updatedAt: new Date() })
          .where(
            and(
              eq(checkOrder.id, id),
              isNull(checkOrder.deletedAt),
              inArray(checkOrder.status, [...statuses]),
              input.from.paymentId === undefined
                ? undefined
                : sql`${checkOrder.paymentId} is not distinct from ${input.from.paymentId}`
            )
          )
          .returning()
          .pipe(Effect.map(firstOrNull));
      },

      complete: (id, input) =>
        sqlClient.withTransaction(
          Effect.gen(function* () {
            // The guarded update is the idempotency check: only an in-flight
            // order closes, so the second of two racing completions writes
            // nothing and, crucially, creates no second verdict.
            const closed = yield* db
              .update(checkOrder)
              .set({ status: 'complete', completedAt: input.completedAt, updatedAt: new Date() })
              .where(
                and(
                  eq(checkOrder.id, id),
                  isNull(checkOrder.deletedAt),
                  inArray(checkOrder.status, inFlightCheckOrderStatuses)
                )
              )
              .returning();
            const order = closed[0];
            if (!order) {
              return null;
            }

            const created = yield* db
              .insert(safetyVerification)
              .values({
                userId: order.userId,
                role: order.role,
                // Never `verified`: a completed check is evidence, a person
                // decides.
                status: 'review_required',
                route: 'credibled',
                checkOrderId: order.id,
                ...input.verification
              })
              .returning();

            // Every check the order fetched becomes a document, so the
            // applicant's checklist stops reading "missing" for evidence they
            // paid for. Nothing of the report is stored — only that the check
            // completed. An existing upload for the same type is left alone
            // unless it was rejected (or deleted), in which case the fetched
            // result supersedes it.
            const items = yield* db
              .select()
              .from(checkOrderItem)
              .where(eq(checkOrderItem.orderId, order.id));
            for (const item of items) {
              yield* db
                .insert(kycDocument)
                .values({
                  userId: order.userId,
                  documentTypeId: item.documentTypeId,
                  filename: null,
                  fileKey: null,
                  expiryDate: null,
                  status: 'submitted',
                  source: 'credibled',
                  reason: null,
                  deletedAt: null
                })
                .onConflictDoUpdate({
                  target: [kycDocument.userId, kycDocument.documentTypeId],
                  set: {
                    filename: null,
                    fileKey: null,
                    expiryDate: null,
                    status: 'submitted',
                    source: 'credibled',
                    reason: null,
                    deletedAt: null,
                    updatedAt: new Date()
                  },
                  setWhere: sql`${kycDocument.status} = 'rejected' or ${kycDocument.deletedAt} is not null`
                });
            }

            return { order, verification: created[0]! };
          })
        ),

      listInFlight: () =>
        db
          .select()
          .from(checkOrder)
          .where(
            and(
              isNull(checkOrder.deletedAt),
              isNotNull(checkOrder.credibledCheckUuid),
              inArray(checkOrder.status, inFlightCheckOrderStatuses)
            )
          ),

      listAwaitingPlacement: () =>
        db
          .select()
          .from(checkOrder)
          .where(
            and(
              isNull(checkOrder.deletedAt),
              eq(checkOrder.status, 'paid'),
              isNull(checkOrder.credibledCheckUuid)
            )
          ),

      listItems: (orderId) =>
        db
          .select()
          .from(checkOrderItem)
          .where(eq(checkOrderItem.orderId, orderId))
          .orderBy(checkOrderItem.createdAt),

      addItem: (input) =>
        db
          .insert(checkOrderItem)
          .values(input)
          .returning()
          .pipe(Effect.map((rows) => rows[0])),

      removeItem: (orderId, itemId) =>
        db
          .delete(checkOrderItem)
          .where(
            and(
              eq(checkOrderItem.id, itemId),
              // Scoped to the order so one applicant can't delete another's
              // basket item by guessing an id.
              eq(checkOrderItem.orderId, orderId)
            )
          )
          .returning()
          .pipe(
            Effect.flatMap((rows) =>
              rows[0]
                ? Effect.succeed(rows[0])
                : Effect.fail(new DBNotFoundError({ entity: 'checkOrderItem', value: itemId }))
            )
          )
    };
  })
);

export const CheckOrderRepoDefault = CheckOrderRepoLive.pipe(Layer.provide(DrizzleLive));

export const makeCheckOrderRepoTest = (implementation: Context.Tag.Service<CheckOrderRepo>) =>
  Layer.succeed(CheckOrderRepo, implementation);

const notFound = () => Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: '' }));

export const EmptyCheckOrderRepoTest = makeCheckOrderRepoTest({
  findById: notFound,
  findOpen: () => Effect.succeed(null),
  findByCredibledUuid: () => Effect.succeed(null),
  create: () => notFound() as never,
  update: notFound,
  claimForPayment: () => Effect.succeed(null),
  advance: () => Effect.succeed(null),
  complete: () => Effect.succeed(null),
  listInFlight: () => Effect.succeed([]),
  listAwaitingPlacement: () => Effect.succeed([]),
  listItems: () => Effect.succeed([]),
  addItem: () => notFound() as never,
  removeItem: notFound
});
