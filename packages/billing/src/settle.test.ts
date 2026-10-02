import { describe, expect, it } from 'bun:test';
import {
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  DBNotFoundError,
  type BillingCustomer,
  type CheckOrder,
  type Payment
} from '@repo/db';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { makePaymentsTest, type ProviderPayment } from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer } from 'effect';
import { settlePayment, settlePaymentByReference } from './settle';

const NOW = new Date('2026-10-02T12:00:00.000Z');

const paymentRow = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'payment-1',
  userId: 'family-1',
  kind: 'credibled_order',
  status: 'pending',
  provider: 'stripe',
  providerReference: 'pi_1',
  refundReference: null,
  amountCents: 7000,
  feeCents: 500,
  taxCents: 0,
  totalCents: 7500,
  currency: 'CAD',
  lastError: null,
  authorisedAt: null,
  capturedAt: null,
  refundedAt: null,
  receiptUrl: null,
  createdAt: new Date('2026-10-02T11:00:00.000Z'),
  updatedAt: new Date('2026-10-02T11:00:00.000Z'),
  ...overrides
});

const orderRow = (overrides: Partial<CheckOrder> = {}): CheckOrder =>
  ({
    id: 'order-1',
    userId: 'family-1',
    role: 'family',
    status: 'payment_pending',
    paymentId: 'payment-1',
    consentAt: null,
    consentPolicyVersion: '2026-08-22',
    deletedAt: null,
    ...overrides
  }) as CheckOrder;

const fetched = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  reference: 'pi_1',
  status: 'succeeded',
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: 'cus_1',
  savesCard: false,
  failureReason: null,
  receiptUrl: 'https://pay.stripe.com/receipts/r1',
  refundedCents: 0,
  paymentMethod: null,
  ...overrides
});

const card = (reference: string) => ({
  reference,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034
});

/** One payment row and one order, held in memory with the live repos'
 * compare-and-set semantics, so concurrent settles really race. */
const makeWorld = (
  options: {
    payment?: Payment;
    order?: CheckOrder | null;
    provider?: ProviderPayment;
    afterCancel?: ProviderPayment;
    billing?: Array<BillingCustomer>;
  } = {}
) => {
  let payment = options.payment ?? paymentRow();
  let order = options.order === undefined ? orderRow() : options.order;
  const calls = {
    getPayment: 0,
    cancelled: [] as Array<string>,
    removedCards: [] as Array<string>,
    enqueued: [] as Array<string>,
    notified: [] as Array<{ userId: string; input: NotificationInput }>
  };
  const billing = makeInMemoryBillingCustomerRepo(options.billing ?? []);

  const layer = Layer.mergeAll(
    makePaymentRepoTest({
      findById: (id) =>
        id === payment.id
          ? Effect.succeed(payment)
          : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
      findByProviderReference: (_provider, reference) =>
        Effect.succeed(payment.providerReference === reference ? payment : null),
      update: (_id, input) => Effect.sync(() => (payment = { ...payment, ...input })),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from) ? input.from : [input.from];
          if (!from.includes(payment.status)) return null;
          payment = { ...payment, ...input.set };
          return payment;
        })
    }),
    makeCheckOrderRepoTest({
      findByPaymentId: (paymentId) =>
        Effect.succeed(order && order.paymentId === paymentId ? order : null),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from.status) ? input.from.status : [input.from.status];
          if (order === null || !from.includes(order.status)) return null;
          if (input.from.paymentId !== undefined && order.paymentId !== input.from.paymentId) {
            return null;
          }
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    makePaymentsTest({
      provider: 'stripe',
      getPayment: () =>
        Effect.sync(() => {
          calls.getPayment += 1;
          return options.provider ?? fetched();
        }),
      cancelPayment: (reference) =>
        Effect.sync(() => {
          calls.cancelled.push(reference);
          return options.afterCancel ?? fetched({ status: 'canceled' });
        }),
      removeCard: (reference) => Effect.sync(() => void calls.removedCards.push(reference))
    }),
    billing.layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          calls.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    makeNotificationHubTest({
      publish: (userId, input) => Effect.sync(() => void calls.notified.push({ userId, input })),
      subscribe: () => Effect.die('not used')
    })
  );

  return {
    layer,
    calls,
    billing,
    payment: () => payment,
    order: () => order
  };
};

const run = <A, E>(world: ReturnType<typeof makeWorld>, effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);

const settle = (world: ReturnType<typeof makeWorld>, paymentId = 'payment-1') =>
  run(world, settlePayment(paymentId, () => NOW).pipe(Effect.provide(world.layer)));

describe('settlePayment', () => {
  it('captures a succeeded payment, marks the order paid and hands it to the worker', async () => {
    const world = makeWorld();
    const result = await settle(world);

    expect(result.outcome).toBe('captured');
    expect(world.payment()).toMatchObject({
      status: 'captured',
      capturedAt: NOW,
      receiptUrl: 'https://pay.stripe.com/receipts/r1'
    });
    expect(world.order()).toMatchObject({ status: 'paid', consentAt: NOW });
    expect(world.calls.enqueued).toEqual(['order-1']);
    expect(world.calls.notified[0]?.input).toEqual({
      type: 'safety_verification.updated',
      payload: { status: 'payment_pending' }
    });
  });

  it('fails a declined payment after cancelling it, and returns the order to the basket', async () => {
    const world = makeWorld({
      provider: fetched({ status: 'failed', failureReason: 'Your card was declined.' })
    });
    const result = await settle(world);

    expect(result.outcome).toBe('failed');
    expect(world.calls.cancelled).toEqual(['pi_1']);
    expect(world.payment()).toMatchObject({
      status: 'failed',
      lastError: 'Your card was declined.'
    });
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
    expect(world.calls.enqueued).toEqual([]);
  });

  it('captures instead when the declined intent succeeded before it could be cancelled', async () => {
    const world = makeWorld({
      provider: fetched({ status: 'failed' }),
      afterCancel: fetched({ status: 'succeeded' })
    });
    const result = await settle(world);
    expect(result.outcome).toBe('captured');
    expect(world.order()?.status).toBe('paid');
  });

  it('fails a canceled payment without cancelling it again', async () => {
    const world = makeWorld({ provider: fetched({ status: 'canceled' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('failed');
    expect(world.calls.cancelled).toEqual([]);
    expect(world.payment().lastError).toBe('The payment was cancelled.');
  });

  it('changes nothing while the provider still needs the payer or is processing', async () => {
    for (const status of ['requires_action', 'processing'] as const) {
      const world = makeWorld({ provider: fetched({ status }) });
      const result = await settle(world);
      expect(result.outcome).toBe('pending');
      expect(world.payment().status).toBe('pending');
      expect(world.order()?.status).toBe('payment_pending');
    }
  });

  it('flags an amount mismatch and changes nothing else', async () => {
    const world = makeWorld({ provider: fetched({ amountCents: 100 }) });
    const result = await settle(world);
    expect(result.outcome).toBe('mismatch');
    expect(world.payment()).toMatchObject({ status: 'pending' });
    expect(world.payment().lastError).toContain('amount');
    expect(world.order()?.status).toBe('payment_pending');
  });

  it('flags a metadata mismatch — an intent that is not this row', async () => {
    const world = makeWorld({ provider: fetched({ metadata: { payment_id: 'payment-9' } }) });
    const result = await settle(world);
    expect(result.outcome).toBe('mismatch');
    expect(world.payment().lastError).toContain('payment-9');
    expect(world.calls.enqueued).toEqual([]);
  });

  it('flags a currency mismatch but accepts the provider’s lower case', async () => {
    const usd = makeWorld({ provider: fetched({ currency: 'usd' }) });
    expect((await settle(usd)).outcome).toBe('mismatch');
    const cad = makeWorld({ provider: fetched({ currency: 'cad' }) });
    expect((await settle(cad)).outcome).toBe('captured');
  });

  it('skips a payment that is already final without asking the provider', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'refunded' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('final');
    expect(world.calls.getPayment).toBe(0);
  });

  it('finishes the order of an already-captured payment whose follow-up never ran', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'captured' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('final');
    expect(world.order()?.status).toBe('paid');
    expect(world.calls.enqueued).toEqual(['order-1']);
  });

  it('leaves a payment recorded under another provider alone', async () => {
    const world = makeWorld({ payment: paymentRow({ provider: 'mock' }) });
    const result = await settle(world);
    expect(result.outcome).toBe('skipped');
    expect(world.calls.getPayment).toBe(0);
  });

  it('applies the outcome exactly once when the browser, webhook and job race', async () => {
    const world = makeWorld();
    const results = await Promise.all([settle(world), settle(world), settle(world)]);
    const outcomes = results.map((result) => result.outcome).sort();
    expect(outcomes).toEqual(['captured', 'final', 'final']);
    expect(world.calls.enqueued.filter((id) => id === 'order-1').length).toBeGreaterThanOrEqual(1);
    expect(world.order()?.status).toBe('paid');
  });

  it('flags money taken for an order that no longer waits for it', async () => {
    const world = makeWorld({ order: null });
    await settle(world);
    expect(world.payment()).toMatchObject({ status: 'captured' });
    expect(world.payment().lastError).toContain('needs manual settlement');
  });
});

describe('saving the card on a family’s first payment', () => {
  it('saves the paying card for the customer that owns the payment', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: null,
          cardBrand: null,
          cardLast4: null,
          cardExpMonth: null,
          cardExpYear: null
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')).toMatchObject({
      cardReference: 'pm_new',
      cardLast4: '4242'
    });
  });

  it('replaces an older card and detaches it at the provider', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: 'pm_old'
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
    expect(world.calls.removedCards).toEqual(['pm_old']);
  });

  it('saves nothing for a one-off payment (a helper, or another card)', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: false, paymentMethod: card('pm_once') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: 'pm_saved'
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_saved');
  });

  it("never saves a card onto another user's customer", async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          userId: 'someone-else',
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: null
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('someone-else')?.cardReference).toBeNull();
  });
});

describe('settlePaymentByReference', () => {
  it('settles the row the provider reference points at', async () => {
    const world = makeWorld();
    const result = await run(
      world,
      settlePaymentByReference('pi_1', () => NOW).pipe(Effect.provide(world.layer))
    );
    expect(result.outcome).toBe('captured');
  });

  it('reports an intent we never created as unknown', async () => {
    const world = makeWorld();
    const result = await run(
      world,
      settlePaymentByReference('pi_unknown', () => NOW).pipe(Effect.provide(world.layer))
    );
    expect(result).toEqual({ outcome: 'unknown' });
    expect(world.calls.getPayment).toBe(0);
  });
});
