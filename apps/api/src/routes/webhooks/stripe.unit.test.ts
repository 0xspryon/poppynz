import { makeIdleContractBillingLayer } from '@repo/billing';
import { SqlError } from '@effect/sql/SqlError';
import {
  dummyBillingCustomer,
  dummyPayoutAccount,
  makeCheckOrderRepoTest,
  makeInMemoryBillingCustomerRepo,
  makeInMemoryPayoutAccountRepo,
  makeInMemorySessionMoneyRepo,
  makeInMemoryCardDisputeRepo,
  makeContractBillingRepoTest,
  makePaymentRepoTest,
  makeStripeWebhookEventRepoTest,
  type CheckOrder,
  type Payment,
  type PayoutAccount,
  type StripeWebhookRecordResult
} from '@repo/db';
import { NoopNotificationHubTest } from '@repo/notify';
import {
  makePaymentsTest,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  type PaymentWebhookEvent,
  type ProviderDispute,
  type ProviderPayment
} from '@repo/payments';
import { makeSafetyVerificationQueueTest } from '@repo/queue';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { BaseAppEnv } from '@/api/app-env';
import { readySnapshot } from '@/api/lib/payouts.test-support';
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
  capturableCents: 0,
  receivedCents: 0,
  captureBefore: null,
  chargeReference: null,
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
    /** The card already on file for family-1. */
    cardOnFile?: string | null;
    /** The card setup family-1 started last (the one being confirmed). */
    latestSetup?: string | null;
    /** Helper payout accounts on file (piece 2b). */
    payoutAccounts?: Array<PayoutAccount>;
    /** Stripe can't be reached when a payout account is re-fetched. */
    payoutProviderFails?: boolean;
    /** Tier 3 step 4: the dispute Stripe answers on a re-fetch. */
    dispute?: () => ProviderDispute;
  } = {}
) => {
  let payment = options.payment === undefined ? paymentRow() : options.payment;
  let order = { id: 'order-1', status: 'payment_pending', paymentId: 'payment-1' } as CheckOrder;
  const log = {
    recorded: [] as Array<string>,
    processed: [] as Array<string>,
    failed: [] as Array<string>,
    enqueued: [] as Array<string>,
    updates: [] as Array<Partial<Payment>>,
    /** Payout accounts re-fetched from the provider. */
    fetchedAccounts: [] as Array<string>
  };
  const billing = makeInMemoryBillingCustomerRepo([
    dummyBillingCustomer({
      provider: 'stripe',
      customerReference: 'cus_1',
      cardReference: options.cardOnFile ?? null,
      latestSetupReference: options.latestSetup ?? null
    })
  ]);
  const billingRetries: Array<string> = [];
  const payouts = makeInMemoryPayoutAccountRepo(options.payoutAccounts ?? []);
  const cardDisputes = makeInMemoryCardDisputeRepo();

  const layer = Layer.mergeAll(
    makeIdleContractBillingLayer(),
    makeContractBillingRepoTest({
      listLiveBillingForFamily: (userId) =>
        Effect.sync(() => {
          billingRetries.push(userId);
          return [];
        })
    }),
    makePaymentsTest({
      provider: 'stripe',
      verifyWebhook: (_raw, signature) =>
        signature === GOOD_SIGNATURE
          ? Effect.succeed(options.verified ?? event())
          : Effect.fail(new PaymentWebhookSignatureError({ reason: 'bad signature' })),
      getPayment: () => Effect.succeed(options.provider ?? fetched()),
      getDispute: (reference) =>
        options.dispute
          ? Effect.succeed(options.dispute())
          : Effect.fail(new PaymentProviderError({ operation: 'getDispute', cause: reference })),
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
        }),
      getPayoutAccount: (reference) => {
        log.fetchedAccounts.push(reference);
        return options.payoutProviderFails
          ? Effect.fail(new PaymentProviderError({ operation: 'getPayoutAccount', cause: 'down' }))
          : Effect.succeed(readySnapshot());
      }
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
    payouts.layer,
    cardDisputes.layer,
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

  return {
    post,
    app,
    layer,
    log,
    billing,
    billingRetries,
    payouts,
    cardDisputes,
    payment: () => payment,
    order: () => order
  };
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

  it('settles a payment whose row never learned its reference, by metadata.payment_id (R3)', async () => {
    // The start's response was lost: no row holds pi_1, but the intent
    // names payment-1.
    const world = makeWorld({
      payment: paymentRow({ providerReference: null }),
      provider: fetched({ receivedCents: 7500 })
    });
    expect(await run(world, event())).toBe('settle: captured');
    expect(world.payment()).toMatchObject({ status: 'captured', providerReference: 'pi_1' });
  });

  it('saves the card of a finished setup for the customer that owns it', async () => {
    const world = makeWorld();
    await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it('never lets a retried older setup replace the card the family has on file now', async () => {
    const world = makeWorld({ cardOnFile: 'pm_newer' });
    const note = await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(note).toBe('card setup: kept');
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_newer');
  });

  it('puts the card of the setup being confirmed now on file, over an older card (B1)', async () => {
    const world = makeWorld({ cardOnFile: 'pm_old', latestSetup: 'seti_1' });
    const note = await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(note).toBe('card setup: saved');
    expect(world.billing.rows.get('family-1')?.cardReference).toBe('pm_new');
  });

  it("retries the family's declined and suspended contract billing once a card is saved", async () => {
    const world = makeWorld();
    await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(world.billingRetries).toEqual(['family-1']);
  });

  it('retries nothing when the setup only replayed an older card', async () => {
    const world = makeWorld({ cardOnFile: 'pm_newer' });
    await run(world, event({ type: 'setup_intent.succeeded', objectId: 'seti_1' }));
    expect(world.billingRetries).toEqual([]);
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
});

describe('card disputes (Tier 3 step 4)', () => {
  const run = (world: ReturnType<typeof makeWorld>, input: PaymentWebhookEvent) =>
    Effect.runPromise(processStripeEvent(input).pipe(Effect.provide(world.layer)));
  const providerDispute = (overrides: Partial<ProviderDispute> = {}): ProviderDispute => ({
    reference: 'du_1',
    status: 'needs_response',
    amountCents: 7500,
    currency: 'cad',
    reason: 'fraudulent',
    paymentReference: 'pi_1',
    chargeReference: 'ch_1',
    evidenceDueBy: new Date('2026-11-05T23:59:59.000Z'),
    chargeRefundable: false,
    hasEvidence: false,
    submissionCount: 0,
    balanceTransactions: [
      { reference: 'txn_w', kind: 'withdrawal', amountCents: 7500, feeCents: 1500 }
    ],
    createdAt: new Date('2026-10-28T10:00:00.000Z'),
    ...overrides
  });

  it.each([
    'charge.dispute.created',
    'charge.dispute.funds_withdrawn',
    'charge.dispute.updated',
    'charge.dispute.closed',
    'charge.dispute.funds_reinstated'
  ])('%s re-fetches the dispute and records it once', async (type) => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      dispute: () => providerDispute()
    });
    const first = await run(world, event({ type, objectId: 'du_1', paymentReference: 'pi_1' }));
    const again = await run(world, event({ type, objectId: 'du_1', paymentReference: 'pi_1' }));
    expect(first).toBe('card dispute: needs_response');
    expect(again).toBe('card dispute: needs_response');
    expect(world.cardDisputes.state.disputes).toHaveLength(1);
    expect(world.cardDisputes.state.disputes[0]).toMatchObject({
      providerReference: 'du_1',
      paymentId: 'payment-1',
      scope: 'payment',
      withdrawnCents: 7500,
      feeCents: 1500
    });
    expect(world.payment()?.lastError).toBe('card dispute opened');
  });

  it('a duplicate delivery is acknowledged and not applied again', async () => {
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      verified: event({
        type: 'charge.dispute.created',
        objectId: 'du_1',
        paymentReference: 'pi_1'
      }),
      seen: 'processed',
      dispute: () => providerDispute()
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(world.cardDisputes.state.disputes).toHaveLength(0);
  });

  it('closing it (won) clears the refund flag; a provider outage is retried (500)', async () => {
    let current = providerDispute();
    const world = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      dispute: () => current
    });
    await run(world, event({ type: 'charge.dispute.created', objectId: 'du_1' }));
    current = providerDispute({
      status: 'won',
      chargeRefundable: true,
      balanceTransactions: [
        ...current.balanceTransactions,
        { reference: 'txn_r', kind: 'reinstatement', amountCents: 7500, feeCents: 0 }
      ]
    });
    await run(world, event({ type: 'charge.dispute.closed', objectId: 'du_1' }));
    expect(world.cardDisputes.state.disputes[0]).toMatchObject({
      status: 'won',
      triage: 'resolved',
      reinstatedCents: 7500
    });
    expect(world.payment()?.lastError).toBeNull();
    const down = makeWorld({
      payment: paymentRow({ status: 'captured' }),
      verified: event({ type: 'charge.dispute.updated', objectId: 'du_1' })
    });
    const response = await down.post();
    expect(response.status).toBe(500);
    expect(down.log.failed).toEqual(['evt_1']);
  });
});

describe('account.updated (piece 2b)', () => {
  const accountUpdated = (overrides: Partial<PaymentWebhookEvent> = {}) =>
    event({
      eventId: 'evt_acct_1',
      type: 'account.updated',
      objectId: 'acct_123',
      account: 'acct_123',
      ...overrides
    });

  it('re-fetches a known account and stores the snapshot', async () => {
    const world = makeWorld({ verified: accountUpdated(), payoutAccounts: [dummyPayoutAccount()] });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.log.fetchedAccounts).toEqual(['acct_123']);
    expect(world.payouts.rows.get('helper-1')?.status).toBe('ready');
    expect(world.log.processed).toEqual(['evt_acct_1']);
  });

  it('records an unknown account and answers 200', async () => {
    const world = makeWorld({
      verified: accountUpdated({
        eventId: 'evt_acct_2',
        objectId: 'acct_unknown',
        account: 'acct_unknown'
      }),
      payoutAccounts: []
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.log.fetchedAccounts).toEqual([]);
    expect(world.log.recorded).toEqual(['evt_acct_2']);
    expect(world.log.processed).toEqual(['evt_acct_2']);
  });

  it('answers 200 to a duplicate delivery without re-fetching', async () => {
    const world = makeWorld({
      verified: accountUpdated(),
      payoutAccounts: [dummyPayoutAccount()],
      seen: 'processed'
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(world.log.fetchedAccounts).toEqual([]);
  });

  it('records and acknowledges any other connected-account event without dispatching it', async () => {
    // `stripe listen --forward-connect-to` forwards every Connect event; a
    // connected account's setup_intent must not reach the platform card path.
    const world = makeWorld({
      verified: event({
        eventId: 'evt_connect_seti',
        type: 'setup_intent.succeeded',
        objectId: 'seti_connected',
        account: 'acct_123'
      }),
      payoutAccounts: [dummyPayoutAccount()]
    });
    const response = await world.post();
    expect(response.status).toBe(200);
    expect(world.log.recorded).toEqual(['evt_connect_seti']);
    expect(world.log.processed).toEqual(['evt_connect_seti']);
    expect(world.billing.rows.get('family-1')?.cardReference).toBeNull();
    expect(
      await Effect.runPromise(
        processStripeEvent(event({ type: 'payment_intent.succeeded', account: 'acct_123' })).pipe(
          Effect.provide(world.layer)
        )
      )
    ).toBe('ignored: connected-account event');
    expect(world.payment()?.status).toBe('pending');
  });

  it('marks the event failed and answers 500 when Stripe cannot be reached', async () => {
    const world = makeWorld({
      verified: accountUpdated(),
      payoutAccounts: [dummyPayoutAccount()],
      payoutProviderFails: true
    });
    const response = await world.post();
    expect(response.status).toBe(500);
    expect(world.log.failed).toEqual(['evt_acct_1']);
    expect(world.log.processed).toEqual([]);
  });
});

describe('session refunds and payouts (Tier 3 step 2)', () => {
  const pendingRefund = (money: ReturnType<typeof makeInMemorySessionMoneyRepo>) => {
    money.state.refunds.push({
      id: 'refund-1',
      refundKey: 'res-1:family_late:0',
      sessionId: 'session-1',
      resolutionId: 'res-1',
      cycleId: 'cycle-1',
      contractId: 'contract-1',
      paymentId: 'payment-1',
      careCents: 4687,
      careTaxLines: [],
      careTaxCents: 0,
      feeCents: 312,
      feeTaxLines: [],
      feeTaxCents: 40,
      totalCents: 5039,
      commissionCents: 937,
      commissionTaxLines: [],
      status: 'pending',
      attempts: 1,
      providerReference: 're_1',
      failureReason: null,
      noticesSent: [],
      refundedAt: null,
      resolvedByUserId: null,
      resolvedNote: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  };
  const layerWith = (
    money: ReturnType<typeof makeInMemorySessionMoneyRepo>,
    status: 'succeeded' | 'failed'
  ) =>
    Layer.mergeAll(
      makeIdleContractBillingLayer(),
      money.layer,
      makePaymentsTest({
        provider: 'stripe',
        getRefund: (reference) =>
          Effect.succeed({
            reference,
            status,
            amountCents: 5039,
            paymentReference: 'pi_1',
            metadata: { refund_id: 'refund-1' },
            failureReason: status === 'failed' ? 'expired_or_canceled_card' : null,
            createdAt: new Date('2026-11-04T09:00:00.000Z')
          })
      })
    );

  it('settles a session refund from its refund event, once however often it is delivered', async () => {
    const money = makeInMemorySessionMoneyRepo();
    pendingRefund(money);
    const layer = layerWith(money, 'succeeded');
    for (const type of ['refund.updated', 'charge.refund.updated']) {
      const note = await Effect.runPromise(
        processStripeEvent(event({ type, objectId: 're_1', paymentReference: 'pi_1' })).pipe(
          Effect.provide(layer)
        )
      );
      expect(note).toBe('session refund: succeeded');
    }
    expect(money.state.refunds[0]).toMatchObject({
      status: 'succeeded',
      refundedAt: new Date('2026-11-04T09:00:00.000Z')
    });
  });

  it('records a failed refund for the admins', async () => {
    const money = makeInMemorySessionMoneyRepo();
    pendingRefund(money);
    await Effect.runPromise(
      processStripeEvent(
        event({ type: 'refund.failed', objectId: 're_1', paymentReference: 'pi_1' })
      ).pipe(Effect.provide(layerWith(money, 'failed')))
    );
    expect(money.state.refunds[0]).toMatchObject({
      status: 'failed',
      failureReason: 'expired_or_canceled_card'
    });
  });

  it('marks a helper’s sent transfers arrived when their payout is paid', async () => {
    const money = makeInMemorySessionMoneyRepo();
    const transfer = await Effect.runPromise(
      money.service.ensureTransfer({
        cycleId: 'cycle-1',
        contractId: 'contract-1',
        helperUserId: 'helper-1',
        sequence: 1,
        status: 'due',
        dueAt: new Date('2026-11-07T05:00:00.000Z')
      })
    );
    await Effect.runPromise(
      money.service.advanceTransfer(transfer.id, {
        from: ['due'],
        set: { status: 'sent', sentAt: new Date('2026-11-07T05:01:00.000Z') }
      })
    );
    const payouts = makeInMemoryPayoutAccountRepo([
      dummyPayoutAccount({ userId: 'helper-1', provider: 'stripe', accountReference: 'acct_1' })
    ]);
    const layer = Layer.mergeAll(
      makeIdleContractBillingLayer(),
      money.layer,
      payouts.layer,
      makePaymentsTest({
        provider: 'stripe',
        getPayout: ({ reference }) =>
          Effect.succeed({
            reference,
            status: 'paid',
            amountCents: 10531,
            arrivalDate: new Date('2026-11-09T00:00:00.000Z'),
            createdAt: new Date('2026-11-08T00:00:00.000Z'),
            failureReason: null
          })
      })
    );
    const note = await Effect.runPromise(
      processStripeEvent(
        event({ type: 'payout.paid', objectId: 'po_1', paymentReference: null, account: 'acct_1' })
      ).pipe(Effect.provide(layer))
    );
    expect(note).toBe('payout: paid: 1 transfer(s) arrived');
    expect(money.state.transfers[0]).toMatchObject({ status: 'paid' });
  });
});
