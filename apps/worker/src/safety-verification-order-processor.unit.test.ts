import { CredibledRequestError, makeCredibledTest } from '@repo/credibled';
import {
  DBNotFoundError,
  makeCheckOrderRepoTest,
  makePaymentRepoTest,
  makeUserRepoTest,
  type CheckOrder,
  type CheckOrderItem,
  type CheckOrderUpdateInput,
  type Payment,
  type PaymentUpdateInput,
  type User
} from '@repo/db';
import { makePaymentsTest, PaymentProviderError } from '@repo/payments';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { placeCheckOrder } from './safety-verification-order-processor';

// Money has changed hands by the time this runs, so the invariant under test
// is that every path ends with an order placed or a charge refunded — never a
// silent drop, and never a second charge.

const order = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'provider-1',
    role: 'service-provider',
    status: 'paid',
    paymentId: 'payment-1',
    credibledCheckUuid: null,
    applicationUrl: null,
    consentAt: new Date('2026-08-01T00:00:00.000Z'),
    consentPolicyVersion: '2026-08-22',
    orderAttempts: 0,
    lastOrderError: null,
    completedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as CheckOrder;

const payment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'provider-1',
    kind: 'credibled_order',
    status: 'authorised',
    provider: 'mock',
    providerReference: 'mock_auth_payment-1',
    refundReference: null,
    amountCents: 4500,
    feeCents: 500,
    taxCents: 0,
    totalCents: 5000,
    currency: 'CAD',
    lastError: null,
    authorisedAt: new Date('2026-08-01T00:00:00.000Z'),
    capturedAt: null,
    refundedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as Payment;

const item = (overrides: Partial<CheckOrderItem> = {}): CheckOrderItem =>
  ({
    id: 'item-1',
    orderId: 'order-1',
    documentTypeId: 'type-1',
    credibledCheckTypeValue: 'request_enhanced_criminal_record_check',
    costCents: 4500,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides
  }) as CheckOrderItem;

const applicant = { id: 'provider-1', email: 'provider@example.com' } as User;

type Recorded = {
  orderUpdates: Array<CheckOrderUpdateInput>;
  paymentUpdates: Array<PaymentUpdateInput>;
  placed: Array<ReadonlyArray<string>>;
  refunds: Array<{ reference: string; idempotencyKey: string }>;
};

const record = (): Recorded => ({ orderUpdates: [], paymentUpdates: [], placed: [], refunds: [] });

const makeLayer = (
  options: {
    order?: CheckOrder | null;
    payment?: Payment | null;
    items?: Array<CheckOrderItem>;
    credibledFails?: boolean;
    refundFails?: boolean;
    recorded?: Recorded;
  } = {}
) => {
  const recorded = options.recorded ?? record();
  const current = options.order === undefined ? order() : options.order;
  const currentPayment = options.payment === undefined ? payment() : options.payment;

  return Layer.mergeAll(
    makeCheckOrderRepoTest({
      findById: (id) =>
        current && current.id === id
          ? Effect.succeed(current)
          : Effect.fail(new DBNotFoundError({ entity: 'checkOrder', value: id })),
      findOpen: () => Effect.succeed(null),
      findByCredibledUuid: () => Effect.succeed(null),
      create: () => Effect.die('not used'),
      update: (_id, input) => {
        recorded.orderUpdates.push(input);
        return Effect.succeed(order({ ...(current ?? {}), ...input } as Partial<CheckOrder>));
      },
      claimForPayment: () => Effect.die('not used'),
      advance: () => Effect.die('not used'),
      complete: () => Effect.die('not used'),
      listInFlight: () => Effect.succeed([]),
      listAwaitingPlacement: () => Effect.succeed(current ? [current] : []),
      listItems: () => Effect.succeed(options.items ?? [item()]),
      addItem: () => Effect.die('not used'),
      removeItem: () => Effect.die('not used')
    }),
    makePaymentRepoTest({
      findById: (id) =>
        currentPayment && currentPayment.id === id
          ? Effect.succeed(currentPayment)
          : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
      create: () => Effect.die('not used'),
      update: (_id, input) => {
        recorded.paymentUpdates.push(input);
        return Effect.succeed(payment({ ...(currentPayment ?? {}), ...input } as Partial<Payment>));
      }
    }),
    makeUserRepoTest({
      findById: () => Effect.succeed(applicant),
      findByEmail: () => Effect.succeed(applicant)
    }),
    makeCredibledTest({
      createBackgroundCheck: ({ email, checkTypeValues }) => {
        recorded.placed.push(checkTypeValues);
        return options.credibledFails
          ? Effect.fail(
              new CredibledRequestError({ operation: 'createCheck', status: 503, cause: 'down' })
            )
          : Effect.succeed({
              uuid: 'check-1',
              email,
              applicationStatus: 'Waiting On Candidate',
              applicationUrl: 'https://credibled.example/apply/check-1'
            });
      }
    }),
    makePaymentsTest({
      refund: ({ reference, idempotencyKey }) => {
        recorded.refunds.push({ reference, idempotencyKey });
        return options.refundFails
          ? Effect.fail(new PaymentProviderError({ operation: 'refund', cause: 'gateway down' }))
          : Effect.succeed({
              refundReference: `mock_refund_${reference}`,
              refundedAt: new Date('2026-08-01T01:00:00.000Z')
            });
      }
    })
  );
};

const run = (layer: ReturnType<typeof makeLayer>) =>
  Effect.runPromiseExit(placeCheckOrder('order-1').pipe(Effect.provide(layer)));

describe('placing a paid check order', () => {
  it('places the order and records what Credibled handed back', async () => {
    const recorded = record();
    const exit = await run(makeLayer({ recorded }));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(recorded.placed).toEqual([['request_enhanced_criminal_record_check']]);
    expect(recorded.orderUpdates.at(-1)).toMatchObject({
      status: 'invited',
      credibledCheckUuid: 'check-1',
      applicationUrl: 'https://credibled.example/apply/check-1',
      lastOrderError: null
    });
    // The verdict is NOT created here — that waits for Credibled to finish.
    expect(recorded.refunds).toHaveLength(0);
  });

  it('is idempotent once the order has been placed', async () => {
    // A redelivered job or the boot-time recovery sweep can land here twice.
    const recorded = record();
    await run(makeLayer({ order: order({ credibledCheckUuid: 'check-1' }), recorded }));

    expect(recorded.placed).toHaveLength(0);
    expect(recorded.orderUpdates).toHaveLength(0);
  });

  it('refuses an order whose charge never settled, and does not refund it', async () => {
    // `paid` with an unsettled payment is an inconsistency to look at, not a
    // case to auto-close — nothing was taken, so there is nothing to give back.
    const recorded = record();
    await run(makeLayer({ payment: payment({ status: 'pending' }), recorded }));

    expect(recorded.placed).toHaveLength(0);
    expect(recorded.refunds).toHaveLength(0);
    expect(recorded.orderUpdates).toHaveLength(0);
  });

  it('hands the job back for retry while attempts remain', async () => {
    const recorded = record();
    const exit = await run(makeLayer({ credibledFails: true, recorded }));

    // Failing the effect is what puts the job on BullMQ's backoff.
    expect(Exit.isFailure(exit)).toBe(true);
    expect(recorded.orderUpdates).toContainEqual({ orderAttempts: 1 });
    expect(recorded.orderUpdates).toContainEqual({ lastOrderError: 'attempt 1 failed' });
    expect(recorded.refunds).toHaveLength(0);
  });

  it('refunds the charge and fails the order once attempts are exhausted', async () => {
    const recorded = record();
    const exit = await run(
      makeLayer({ order: order({ orderAttempts: 2 }), credibledFails: true, recorded })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    // Keyed on the payment row, so a lost record of a successful refund is
    // retried under the same key rather than refunded twice.
    expect(recorded.refunds).toEqual([
      { reference: 'mock_auth_payment-1', idempotencyKey: 'payment-1' }
    ]);
    expect(recorded.paymentUpdates.at(-1)).toMatchObject({
      status: 'refunded',
      refundReference: 'mock_refund_mock_auth_payment-1'
    });
    expect(recorded.orderUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('keeps the order retryable when the refund itself fails', async () => {
    // A failed refund must stay visible on the row holding the money, and the
    // order must not be closed as if it were settled.
    const recorded = record();
    await run(
      makeLayer({
        order: order({ orderAttempts: 2 }),
        credibledFails: true,
        refundFails: true,
        recorded
      })
    );

    expect(recorded.paymentUpdates.at(-1)?.lastError).toMatch(/needs manual settlement/);
    expect(recorded.paymentUpdates.at(-1)?.status).toBeUndefined();
    expect(recorded.orderUpdates.some((update) => update.status === 'failed')).toBe(false);
  });

  it('refunds rather than calling Credibled with an empty basket', async () => {
    const recorded = record();
    await run(makeLayer({ items: [], recorded }));

    expect(recorded.placed).toHaveLength(0);
    expect(recorded.refunds.map((refund) => refund.reference)).toEqual(['mock_auth_payment-1']);
    expect(recorded.orderUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });
});
