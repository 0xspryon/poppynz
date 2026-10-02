import { SqlError } from '@effect/sql/SqlError';
import {
  dummyBillingCustomer,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makePaymentRepoTest,
  makeStripeWebhookEventRepoTest,
  type CheckOrder,
  type Payment,
  type StripeWebhookRecordResult
} from '@repo/db';
import { NoopNotificationHubTest } from '@repo/notify';
import {
  makePaymentsTest,
  PaymentWebhookSignatureError,
  type PaymentWebhookEvent,
  type ProviderPayment
} from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { BaseAppEnv } from '@/api/app-env';
import { processStripeEvent, stripeWebhookRoute } from './stripe';

// Public ingress with no session: the signature is the only authentication,
// and every object is re-fetched before anything is written.

const GOOD_SIGNATURE = 't=1,v1=good';

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
    ...overrides
  }) as Payment;

const fetched = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  reference: 'pi_1',
  status: 'succeeded',
  amountCents: 7500,
  currency: 'cad',
  metadata: { payment_id: 'payment-1' },
  customer: null,
  savesCard: false,
  failureReason: null,
  receiptUrl: null,
  refundedCents: 0,
  paymentMethod: null,
  ...overrides
});

const event = (overrides: Partial<PaymentWebhookEvent> = {}): PaymentWebhookEvent => ({
  eventId: 'evt_1',
  type: 'payment_intent.succeeded',
  objectId: 'pi_1',
  paymentReference: null,
  account: null,
  ...overrides
});

const makeWorld = (
  options: {
    payment?: Payment | null;
    provider?: ProviderPayment;
    verified?: PaymentWebhookEvent;
    seen?: StripeWebhookRecordResult;
    /** The payment table is down while the event is applied. */
    processingFails?: boolean;
  } = {}
) => {
  let payment = options.payment === undefined ? paymentRow() : options.payment;
  let order = { id: 'order-1', status: 'payment_pending', paymentId: 'payment-1' } as CheckOrder;
  const log = {
    recorded: [] as Array<string>,
    processed: [] as Array<string>,
    failed: [] as Array<string>,
    enqueued: [] as Array<string>,
    updates: [] as Array<Partial<Payment>>
  };
  const billing = makeInMemoryBillingCustomerRepo([
    dummyBillingCustomer({ provider: 'stripe', customerReference: 'cus_1', cardReference: null })
  ]);

  const layer = Layer.mergeAll(
    makePaymentsTest({
      provider: 'stripe',
      verifyWebhook: (_raw, signature) =>
        signature === GOOD_SIGNATURE
          ? Effect.succeed(options.verified ?? event())
          : Effect.fail(new PaymentWebhookSignatureError({ reason: 'bad signature' })),
      getPayment: () => Effect.succeed(options.provider ?? fetched()),
      getCardSetup: (reference) =>
        Effect.succeed({
          reference,
          status: 'succeeded',
          customer: 'cus_1',
          paymentMethod: {
            reference: 'pm_new',
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2034
          }
        })
    }),
    makeStripeWebhookEventRepoTest({
      record: ({ eventId }) =>
        Effect.sync(() => {
          log.recorded.push(eventId);
          return options.seen ?? 'new';
        }),
      markProcessed: (eventId) => Effect.sync(() => void log.processed.push(eventId)),
      markFailed: (eventId) => Effect.sync(() => void log.failed.push(eventId))
    }),
    makePaymentRepoTest({
      findById: () => Effect.succeed(payment!),
      findByProviderReference: (_provider, reference) =>
        options.processingFails
          ? Effect.fail(new SqlError({ cause: 'database is down' }))
          : Effect.succeed(payment && payment.providerReference === reference ? payment : null),
      update: (_id, input) =>
        Effect.sync(() => {
          log.updates.push(input);
          payment = { ...payment!, ...input };
          return payment;
        }),
      advance: (_id, input) =>
        Effect.sync(() => {
          const from = Array.isArray(input.from) ? input.from : [input.from];
          if (!payment || !from.includes(payment.status)) return null;
          payment = { ...payment, ...input.set };
          return payment;
        })
    }),
    makeCheckOrderRepoTest({
      findByPaymentId: (paymentId) => Effect.succeed(order.paymentId === paymentId ? order : null),
      advance: (_id, input) =>
        Effect.sync(() => {
          order = { ...order, ...input.set } as CheckOrder;
          return order;
        })
    }),
    billing.layer,
    makeSafetyVerificationQueueTest({
      enqueueOrder: ({ orderId }) =>
        Effect.sync(() => {
          log.enqueued.push(orderId);
          return { id: 'job-1', name: 'place' };
        })
    }),
    NoopNotificationHubTest
  );

  const runtime = ManagedRuntime.make(layer);
  const app = new Hono<BaseAppEnv>()
    .use('*', async (c, next) => {
      c.set('runtime', runtime as never);
      await next();
    })
    .route('/webhooks/stripe', stripeWebhookRoute);

  const post = (signature: string | null = GOOD_SIGNATURE, body = '{"id":"evt_1"}') =>
    app.request('/webhooks/stripe', {
      method: 'POST',
      headers: signature === null ? {} : { 'stripe-signature': signature },
      body
    });

  return { post, app, layer, log, billing, payment: () => payment, order: () => order };
};

describe('POST /webhooks/stripe', () => {
  it('refuses a bad signature with 400 and records nothing', async () => {
    const world = makeWorld();
    const response = await world.post('t=1,v1=forged');
    expect(response.status).toBe(400);
    expect(world.log.recorded).toEqual([]);
    expect(world.payment()?.status).toBe('pending');
  });

  it('refuses a delivery with no signature at all', async () => {
    const world = makeWorld();
    expect((await world.post(null)).status).toBe(400);
  });

  it('refuses an oversized body before reading it', async () => {
    const world = makeWorld();
    const response = await world.post(GOOD_SIGNATURE, 'x'.repeat(600 * 1024));
    expect(response.status).toBe(413);
  });

  it('refuses a declared-oversized body without reading it all', async () => {
    const world = makeWorld();
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    const TOTAL_CHUNKS = 10_000; // ~10 MiB if ever fully drained.
    let pulled = 0;
    // A body backed by a stream, closing only once fully drained, so we can
    // tell whether it was read at all: a plain string body is buffered by
    // the Request constructor itself, which would hide a regression back to
    // "read everything, then check the length".
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(chunk);
      }
    });
    const request = new Request('http://localhost/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': GOOD_SIGNATURE, 'content-length': String(600 * 1024) },
      body: stream,
      duplex: 'half'
    } as RequestInit);
    const response = await world.app.request(request);
    expect(response.status).toBe(413);
    expect(world.log.recorded).toEqual([]);
    // The declared Content-Length alone was enough to refuse it — at most a
    // single probe read, nowhere near the full 10,000-chunk stream.
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('refuses an oversized streamed body with no content-length, stopping mid-stream', async () => {
    const world = makeWorld();
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    const TOTAL_CHUNKS = 10_000; // ~10 MiB if ever fully drained — far past the 512 KiB limit.
    let pulled = 0;
    // Streamed with no Content-Length (chunked transfer), as Stripe or a
    // malicious client could send. Never closes on its own past the limit,
    // so a regression back to "buffer it all, then check" would make this
    // test read every one of the 10,000 chunks instead of stopping early.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        pulled++;
        controller.enqueue(chunk);
      }
    });
    const request = new Request('http://localhost/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': GOOD_SIGNATURE },
      body: stream,
      duplex: 'half'
    } as RequestInit);
    const response = await world.app.request(request);
    expect(response.status).toBe(413);
    expect(world.log.recorded).toEqual([]);
    // Stopped partway through the 512 KiB limit (1 KiB chunks), nowhere near
    // the full 10,000-chunk stream.
    expect(pulled).toBeGreaterThan(0);
    expect(pulled).toBeLessThan(1000);
  });

  it('settles a succeeded payment from the re-fetched intent and marks the event processed', async () => {
    const world = makeWorld();
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.payment()?.status).toBe('captured');
    expect(world.order().status).toBe('paid');
    expect(world.log.enqueued).toEqual(['order-1']);
    expect(world.log.processed).toEqual(['evt_1']);
  });

  it('acknowledges a duplicate of a processed event without touching anything', async () => {
    const world = makeWorld({ seen: 'processed' });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(world.payment()?.status).toBe('pending');
  });

  it('reprocesses an event whose earlier delivery failed', async () => {
    const world = makeWorld({ seen: 'unprocessed' });
    expect((await world.post()).status).toBe(200);
    expect(world.payment()?.status).toBe('captured');
  });

  it('records a processing failure and answers 500 so Stripe retries', async () => {
    const world = makeWorld({ processingFails: true });
    const response = await world.post();
    expect(response.status).toBe(500);
    expect(world.log.failed).toEqual(['evt_1']);
    expect(world.log.processed).toEqual([]);
  });

  it('acknowledges an event type it does not handle', async () => {
    const world = makeWorld({ verified: event({ type: 'customer.created', objectId: 'cus_1' }) });
    expect((await world.post()).status).toBe(200);
    expect(world.log.processed).toEqual(['evt_1']);
  });
});

describe('processStripeEvent', () => {
  const run = (world: ReturnType<typeof makeWorld>, input: PaymentWebhookEvent) =>
    Effect.runPromise(processStripeEvent(input).pipe(Effect.provide(world.layer)));

  it('fails a payment Stripe reports as canceled', async () => {
    const world = makeWorld({ provider: fetched({ status: 'canceled' }) });
    await run(world, event({ type: 'payment_intent.canceled' }));
    expect(world.payment()?.status).toBe('failed');
    expect(world.order()).toMatchObject({ status: 'draft', paymentId: null });
  });

  it('ignores a payment intent we never created', async () => {
    const world = makeWorld({ payment: null });
    expect(await run(world, event())).toBe('settle: unknown');
  });

  it('saves the card of a finished setup for the customer that owns it', async () => {
    const world = makeWorld();
    await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it('marks a fully refunded charge refunded', async () => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      provider: fetched({ refundedCents: 7500 })
    });
    const note = await run(
      world,
      event({ type: 'charge.refunded', objectId: 'ch_1', paymentReference: 'pi_1' })
    );
    expect(note).toBe('refunded');
    expect(world.payment()?.status).toBe('refunded');
  });

  it('leaves a partial refund alone', async () => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      provider: fetched({ refundedCents: 1000 })
    });
    await run(
      world,
      event({ type: 'charge.refunded', objectId: 'ch_1', paymentReference: 'pi_1' })
    );
    expect(world.payment()?.status).toBe('captured');
  });

  it('flags a payment when its card dispute opens', async () => {
    const world = makeWorld({ payment: paymentRow({ status: 'captured' }) });
    await run(
      world,
      event({ type: 'charge.dispute.created', objectId: 'dp_1', paymentReference: 'pi_1' })
    );
    expect(world.payment()?.lastError).toBe('card dispute opened');
  });
});
