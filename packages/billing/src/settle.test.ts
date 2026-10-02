import { describe, expect, it } from 'bun:test';
import { SqlError } from '@effect/sql/SqlError';
import {
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  DBNotFoundError,
  type BillingCustomer,
  type CheckOrder,
  type CheckOrderAdvanceInput,
  type Payment
} from '@repo/db';
import { makeNotificationHubTest, type NotificationInput } from '@repo/notify';
import { makePaymentsTest, type ProviderPayment } from '@repo/payments';
import { makeSafetyVerificationQueueTest, SafetyVerificationQueueError } from '@repo/queue';
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
    /** The queue refuses the order (Redis down): settle fails after the CAS. */
    queueFails?: boolean;
    /** Another caller moves the row to this status between our read and CAS. */
    captureLostTo?: Payment['status'];
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
          if (options.captureLostTo && payment.status === 'pending') {
            payment = { ...payment, status: options.captureLostTo };
          }
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
        Effect.gen(function* () {
          calls.getPayment += 1;
          // Three concurrent settles each start from their own (synchronous)
          // read of the row, then all land here before any of them reaches
          // the payment's CAS — yielding is what makes that genuinely
          // concurrent rather than each caller running start-to-finish
          // before the next one is even scheduled, so the losers really hit
          // `advance`'s `from` guard instead of short-circuiting through the
          // already-final branch at the top of `settleRow`.
          yield* Effect.yieldNow();
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
        options.queueFails
          ? Effect.fail(new SafetyVerificationQueueError({ cause: 'redis down' }))
          : Effect.sync(() => {
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
    // All three really reached the provider and the payment's CAS — the
    // losers' `final` came from losing `advance`, not from reading an
    // already-captured row at the top of `settleRow` before the winner ever
    // wrote it (the mock `getPayment` yields so the three genuinely
    // interleave; this would fail if `advance` ignored `from`, because a
    // caller would then succeed from a status it should have lost against).
    expect(world.calls.getPayment).toBe(3);
    expect(world.calls.enqueued.filter((id) => id === 'order-1').length).toBeGreaterThanOrEqual(1);
    expect(world.order()?.status).toBe('paid');
  });

  describe('recovering a follow-up that crashed before it could run', () => {
    /** A world whose first `CheckOrderRepo.advance` call blows up — as if the
     * process died between recording the payment's new status and finishing
     * the order — and behaves normally afterwards. */
    const makeCrashingWorld = (provider: ProviderPayment) => {
      let payment = paymentRow();
      let order: CheckOrder | null = orderRow();
      let orderAdvanceCalls = 0;
      const calls = {
        enqueued: [] as Array<string>,
        notified: [] as Array<{ userId: string; input: NotificationInput }>
      };

      const layer = Layer.mergeAll(
        makePaymentRepoTest({
          findById: (id) =>
            id === payment.id
              ? Effect.succeed(payment)
              : Effect.fail(new DBNotFoundError({ entity: 'payment', value: id })),
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
          advance: (_id, input: CheckOrderAdvanceInput) => {
            orderAdvanceCalls += 1;
            if (orderAdvanceCalls === 1) {
              return Effect.fail(new SqlError({ cause: 'connection reset' }));
            }
            return Effect.sync(() => {
              const from = Array.isArray(input.from.status)
                ? input.from.status
                : [input.from.status];
              if (order === null || !from.includes(order.status)) return null;
              if (input.from.paymentId !== undefined && order.paymentId !== input.from.paymentId) {
                return null;
              }
              order = { ...order, ...input.set } as CheckOrder;
              return order;
            });
          }
        }),
        makePaymentsTest({ provider: 'stripe', getPayment: () => Effect.succeed(provider) }),
        makeInMemoryBillingCustomerRepo([]).layer,
        makeSafetyVerificationQueueTest({
          enqueueOrder: ({ orderId }) =>
            Effect.sync(() => {
              calls.enqueued.push(orderId);
              return { id: 'job-1', name: 'place' };
            })
        }),
        makeNotificationHubTest({
          publish: (userId, input) =>
            Effect.sync(() => void calls.notified.push({ userId, input })),
          subscribe: () => Effect.die('not used')
        })
      );

      return {
        layer,
        calls,
        payment: () => payment,
        order: () => order
      };
    };

    it("finishes the order on a later call after the capturing call's own finishOrder crashed", async () => {
      const world = makeCrashingWorld(fetched());

      // The crash surfaces as a rejected settlePayment call, but the
      // payment's own CAS had already landed before it — that write and the
      // order's follow-up are not atomic with each other.
      await expect(
        Effect.runPromise(settlePayment('payment-1', () => NOW).pipe(Effect.provide(world.layer)))
      ).rejects.toThrow();
      expect(world.payment()).toMatchObject({ status: 'captured' });
      expect(world.order()).toMatchObject({ status: 'payment_pending' });

      // The webhook retrying, or the worker's recovery sweep, reaches the
      // now-`captured` row through the final-status branch and finishes what
      // the first call started.
      const result = await Effect.runPromise(
        settlePayment('payment-1', () => NOW).pipe(Effect.provide(world.layer))
      );
      expect(result.outcome).toBe('final');
      expect(world.order()).toMatchObject({ status: 'paid' });
      expect(world.calls.enqueued).toEqual(['order-1']);
    });

    it("reverts the order on a later call after the failing call's own revert crashed", async () => {
      const world = makeCrashingWorld(fetched({ status: 'canceled' }));

      await expect(
        Effect.runPromise(settlePayment('payment-1', () => NOW).pipe(Effect.provide(world.layer)))
      ).rejects.toThrow();
      expect(world.payment()).toMatchObject({ status: 'failed' });
      expect(world.order()).toMatchObject({ status: 'payment_pending' });

      const result = await Effect.runPromise(
        settlePayment('payment-1', () => NOW).pipe(Effect.provide(world.layer))
      );
      expect(result.outcome).toBe('final');
      expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
      expect(world.calls.notified[0]?.input).toEqual({
        type: 'safety_verification.updated',
        payload: { status: 'not_started' }
      });
    });
  });

  it('flags money taken for an order that no longer waits for it', async () => {
    const world = makeWorld({ order: null });
    await settle(world);
    expect(world.payment()).toMatchObject({ status: 'captured' });
    expect(world.payment().lastError).toContain('needs manual settlement');
  });
});

const emptyStripeFamily = () =>
  dummyBillingCustomer({
    provider: 'stripe',
    customerReference: 'cus_1',
    cardReference: null,
    cardBrand: null,
    cardLast4: null,
    cardExpMonth: null,
    cardExpYear: null
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

  it('keeps a card the family added since the payment started, and detaches nothing', async () => {
    // The payment asked to save its card because none was on file then; a
    // late settle (recovery job, webhook retry) must not replace the card
    // the family has added in Billing since.
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [
        dummyBillingCustomer({
          provider: 'stripe',
          customerReference: 'cus_1',
          cardReference: 'pm_added_in_billing'
        })
      ]
    });
    await settle(world);
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_added_in_billing');
    expect(world.calls.removedCards).toEqual([]);
  });

  it('saves the card even when handing the order to the worker fails', async () => {
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [emptyStripeFamily()],
      queueFails: true
    });
    await expect(settle(world)).rejects.toThrow();
    expect(world.payment()).toMatchObject({ status: 'captured' });
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it('saves the card from the losing settle when the winner never got to it', async () => {
    // Another caller captured the row between our read and our CAS, then
    // crashed before its own follow-up: we still hold the fetched intent.
    const world = makeWorld({
      provider: fetched({ savesCard: true, paymentMethod: card('pm_new') }),
      billing: [emptyStripeFamily()],
      captureLostTo: 'captured'
    });
    const result = await settle(world);
    expect(result.outcome).toBe('final');
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
    expect(world.order()).toMatchObject({ status: 'paid' });
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
