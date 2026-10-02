import {
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  type CheckOrder,
  type Payment
} from '@repo/db';
import { NoopNotificationHubTest } from '@repo/notify';
import { makePaymentsTest, type ProviderPayment } from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { recoverPendingPayments } from './payment-recovery-processor';

// The backstop for a closed tab or a lost webhook: nothing here may take
// money twice, and an abandoned payment must free its order.

const NOW = new Date('2026-10-02T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const paymentRow = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    userId: 'family-1',
    kind: 'credibled_order',
    status: 'pending',
    provider: 'stripe',
    providerReference: 'pi_1',
    totalCents: 7500,
    currency: 'CAD',
    lastError: null,
    createdAt: minutesAgo(30),
    ...overrides
  }) as Payment;

const intent = (status: ProviderPayment['status']): ProviderPayment => ({
  reference: 'pi_1',
  status,
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: null,
  savesCard: false,
  failureReason: null,
  receiptUrl: null,
  refundedCents: 0,
  paymentMethod: null
});

const makeWorld = (options: { payment: Payment; provider: ProviderPayment['status'] }) => {
  let payment = options.payment;
  let providerStatus = options.provider;
  let order = { id: 'order-1', status: 'payment_pending', paymentId: 'payment-1' } as CheckOrder;
  const seen = {
    staleBefore: [] as Array<Date>,
    cancelled: [] as Array<string>,
    enqueued: [] as Array<string>
  };

  const layer = Layer.mergeAll(
    makePaymentRepoTest({
      listStalePending: (_provider, createdBefore) =>
        Effect.sync(() => {
          seen.staleBefore.push(createdBefore);
          return payment.createdAt < createdBefore && payment.status === 'pending' ? [payment] : [];
        }),
      findById: () => Effect.sync(() => payment),
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
        Effect.sync(() => (order.paymentId === paymentId ? order : null)),
      advance: (_id, input) =>
        Effect.sync(() => {
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    makePaymentsTest({
      provider: 'stripe',
      getPayment: () => Effect.sync(() => intent(providerStatus)),
      cancelPayment: (reference) =>
        Effect.sync(() => {
          seen.cancelled.push(reference);
          if (providerStatus !== 'succeeded') providerStatus = 'canceled';
          return intent(providerStatus);
        })
    }),
    makeInMemoryBillingCustomerRepo([]).layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          seen.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    NoopNotificationHubTest
  );
  const run = () => Effect.runPromise(recoverPendingPayments(NOW).pipe(Effect.provide(layer)));
  return { run, seen, payment: () => payment, order: () => order };
};

describe('recoverPendingPayments', () => {
  it('only looks at payments older than the settle window', async () => {
    const world = makeWorld({ payment: paymentRow(), provider: 'succeeded' });
    await world.run();
    expect(world.seen.staleBefore).toEqual([minutesAgo(10)]);
  });

  it('settles a payment whose tab closed after 10 minutes', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(11) }),
      provider: 'succeeded'
    });
    const summary = await world.run();
    expect(summary).toEqual({ checked: 1, captured: 1, failed: 0, abandoned: 0, errors: 0 });
    expect(world.payment().status).toBe('captured');
    expect(world.seen.enqueued).toEqual(['order-1']);
  });

  it('leaves a payment the payer is still confirming alone inside a day', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(60) }),
      provider: 'requires_action'
    });
    const summary = await world.run();
    expect(summary).toMatchObject({ checked: 1, captured: 0, failed: 0, abandoned: 0 });
    expect(world.seen.cancelled).toEqual([]);
    expect(world.payment().status).toBe('pending');
  });

  it('cancels a payment unfinished after 24 hours and returns its order to the basket', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(24 * 60 + 1) }),
      provider: 'requires_action'
    });
    const summary = await world.run();
    expect(summary).toEqual({ checked: 1, captured: 0, failed: 1, abandoned: 1, errors: 0 });
    expect(world.seen.cancelled).toEqual(['pi_1']);
    expect(world.payment().status).toBe('failed');
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
  });

  it('captures instead when an "abandoned" payment had in fact succeeded', async () => {
    const world = makeWorld({
      payment: paymentRow({ createdAt: minutesAgo(24 * 60 + 1) }),
      provider: 'succeeded'
    });
    const summary = await world.run();
    expect(summary).toMatchObject({ captured: 1, abandoned: 1 });
    expect(world.payment().status).toBe('captured');
  });
});
