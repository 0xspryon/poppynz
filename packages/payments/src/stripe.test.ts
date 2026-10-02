import { describe, expect, it } from 'bun:test';
import Stripe from 'stripe';
import { Effect, Exit } from 'effect';
import { quoteFromPolicy } from './port';
import { makeStripePayments, normaliseStatus, type StripeApi } from './stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';

type Recorded = { method: string; params: [unknown, unknown] };

const intent = (overrides: Record<string, unknown> = {}) => ({
  id: 'pi_123',
  object: 'payment_intent',
  amount: 7500,
  currency: 'cad',
  status: 'requires_payment_method',
  client_secret: 'pi_123_secret_abc',
  last_payment_error: null,
  latest_charge: null,
  customer: null,
  payment_method: null,
  setup_future_usage: null,
  metadata: { payment_id: 'payment-1' },
  ...overrides
});

const card = {
  id: 'pm_card',
  object: 'payment_method',
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2034 }
};

/** A fake of the SDK slice the adapter uses. Every call is recorded; each
 * resource answers with what the test hands it. */
const fakeStripe = (
  answers: {
    create?: () => unknown;
    retrieve?: () => unknown;
    cancel?: () => unknown;
    setupCreate?: () => unknown;
    setupRetrieve?: () => unknown;
  } = {}
) => {
  const calls: Array<Recorded> = [];
  const record =
    (method: string, answer: () => unknown) => async (first?: unknown, second?: unknown) => {
      calls.push({ method, params: [first, second] });
      return answer() as never;
    };
  const client = {
    paymentIntents: {
      create: record('paymentIntents.create', answers.create ?? (() => intent())),
      retrieve: record('paymentIntents.retrieve', answers.retrieve ?? (() => intent())),
      cancel: record('paymentIntents.cancel', answers.cancel ?? (() => intent()))
    },
    setupIntents: {
      create: record(
        'setupIntents.create',
        answers.setupCreate ?? (() => ({ id: 'seti_1', client_secret: 'seti_1_secret' }))
      ),
      retrieve: record(
        'setupIntents.retrieve',
        answers.setupRetrieve ??
          (() => ({
            id: 'seti_1',
            status: 'succeeded',
            last_setup_error: null,
            customer: 'cus_1',
            payment_method: card
          }))
      )
    },
    customers: { create: record('customers.create', () => ({ id: 'cus_new' })) },
    paymentMethods: { detach: record('paymentMethods.detach', () => card) },
    refunds: { create: record('refunds.create', () => ({ id: 're_1', created: 1_790_000_000 })) },
    // The real verifier: signatures are what this suite is about.
    webhooks: Stripe.webhooks
  } as unknown as StripeApi;
  return { client, calls };
};

const quote = quoteFromPolicy([{ label: 'Check', costCents: 7000 }], {
  adminFeeCents: 500,
  taxRateBasisPoints: 0
});

describe('normaliseStatus', () => {
  it('folds Stripe intent statuses into the port statuses', () => {
    expect(normaliseStatus('succeeded', false)).toBe('succeeded');
    expect(normaliseStatus('processing', false)).toBe('processing');
    expect(normaliseStatus('canceled', false)).toBe('canceled');
    expect(normaliseStatus('requires_action', false)).toBe('requires_action');
    expect(normaliseStatus('requires_confirmation', false)).toBe('requires_action');
    // Waiting for a card vs. a declined attempt.
    expect(normaliseStatus('requires_payment_method', false)).toBe('requires_action');
    expect(normaliseStatus('requires_payment_method', true)).toBe('failed');
  });
});

describe('startPayment', () => {
  it('creates a card-only, automatically captured intent keyed on the caller key', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });

    const result = await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        saveCard: false
      })
    );

    expect(result).toEqual({
      reference: 'pi_123',
      clientSecret: 'pi_123_secret_abc',
      status: 'requires_action',
      paymentMethodReference: null
    });
    const [params, options] = calls[0]!.params as [Record<string, unknown>, unknown];
    expect(params).toEqual({
      amount: 7500,
      currency: 'cad',
      allowed_payment_method_types: ['card'],
      capture_method: 'automatic',
      metadata: { payment_id: 'payment-1' }
    });
    expect(options).toEqual({ idempotencyKey: 'payment-payment-1' });
  });

  it('asks Stripe to keep a family card for off-session use', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        customer: 'cus_1',
        saveCard: true
      })
    );
    const params = calls[0]!.params[0] as Record<string, unknown>;
    expect(params).toMatchObject({ customer: 'cus_1', setup_future_usage: 'off_session' });
    expect(params).not.toHaveProperty('payment_method');
  });

  it('pre-attaches a saved card for one-click payment and does not save again', async () => {
    const { client, calls } = fakeStripe({
      create: () => intent({ payment_method: 'pm_saved', status: 'requires_confirmation' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(
      payments.startPayment({
        quote,
        idempotencyKey: 'payment-1',
        metadata: { payment_id: 'payment-1' },
        customer: 'cus_1',
        savedCard: 'pm_saved',
        saveCard: false
      })
    );
    const params = calls[0]!.params[0] as Record<string, unknown>;
    expect(params).toMatchObject({ customer: 'cus_1', payment_method: 'pm_saved' });
    expect(params).not.toHaveProperty('setup_future_usage');
    expect(result.paymentMethodReference).toBe('pm_saved');
  });

  it('turns a card error into a decline and anything else into a provider error', async () => {
    const declined = makeStripePayments({
      client: fakeStripe({
        create: () => {
          throw new Stripe.errors.StripeCardError({ message: 'Your card was declined.' });
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const input = {
      quote,
      idempotencyKey: 'payment-1',
      metadata: { payment_id: 'payment-1' },
      saveCard: false
    };
    const declinedExit = await Effect.runPromiseExit(declined.startPayment(input));
    expect(declinedExit).toEqual(
      Exit.fail(expect.objectContaining({ _tag: 'PaymentDeclinedError' }) as never)
    );

    const broken = makeStripePayments({
      client: fakeStripe({
        create: () => {
          throw new Stripe.errors.StripeAPIError({ message: 'boom' });
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const brokenExit = await Effect.runPromiseExit(broken.startPayment(input));
    expect(brokenExit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'PaymentProviderError',
          operation: 'startPayment'
        }) as never
      )
    );
  });
});

describe('getPayment', () => {
  it('normalises the re-fetched intent with its charge and card', async () => {
    const { client, calls } = fakeStripe({
      retrieve: () =>
        intent({
          status: 'succeeded',
          customer: 'cus_1',
          setup_future_usage: 'off_session',
          payment_method: card,
          latest_charge: {
            id: 'ch_1',
            receipt_url: 'https://pay.stripe.com/receipts/r1',
            amount_refunded: 0
          }
        })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });

    const result = await Effect.runPromise(payments.getPayment('pi_123'));

    expect(result).toEqual({
      reference: 'pi_123',
      status: 'succeeded',
      amountCents: 7500,
      currency: 'cad',
      metadata: { payment_id: 'payment-1' },
      customer: 'cus_1',
      savesCard: true,
      failureReason: null,
      receiptUrl: 'https://pay.stripe.com/receipts/r1',
      refundedCents: 0,
      paymentMethod: {
        reference: 'pm_card',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2034
      }
    });
    expect(calls[0]!.params).toEqual(['pi_123', { expand: ['latest_charge', 'payment_method'] }]);
  });

  it('reports a declined attempt as failed with Stripe’s message', async () => {
    const { client } = fakeStripe({
      retrieve: () =>
        intent({ last_payment_error: { message: 'Your card has insufficient funds.' } })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.getPayment('pi_123'));
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('Your card has insufficient funds.');
  });
});

describe('cancelPayment', () => {
  it('returns the intent as it is when Stripe refuses because it already succeeded', async () => {
    const { client } = fakeStripe({
      cancel: () => {
        throw new Stripe.errors.StripeInvalidRequestError({
          message: 'cannot cancel',
          code: 'payment_intent_unexpected_state'
        });
      },
      retrieve: () => intent({ status: 'succeeded' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.cancelPayment('pi_123'));
    expect(result.status).toBe('succeeded');
  });
});

describe('customers, cards and refunds', () => {
  it('creates a customer once per user and reuses an existing one', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const created = await Effect.runPromise(
      payments.ensureCustomer({ userId: 'u1', email: 'a@b.c', name: 'A', existing: null })
    );
    const reused = await Effect.runPromise(
      payments.ensureCustomer({ userId: 'u1', email: 'a@b.c', name: 'A', existing: 'cus_old' })
    );
    expect(created).toBe('cus_new');
    expect(reused).toBe('cus_old');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([
      { email: 'a@b.c', name: 'A', metadata: { user_id: 'u1' } },
      { idempotencyKey: 'customer-u1' }
    ]);
  });

  it('starts an off-session card-only setup and reads its card back', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const setup = await Effect.runPromise(payments.startCardSetup('cus_1'));
    const fetched = await Effect.runPromise(payments.getCardSetup('seti_1'));
    expect(setup).toEqual({ reference: 'seti_1', clientSecret: 'seti_1_secret' });
    expect(calls[0]!.params).toEqual([
      { customer: 'cus_1', usage: 'off_session', allowed_payment_method_types: ['card'] },
      undefined
    ]);
    expect(fetched).toMatchObject({ status: 'succeeded', customer: 'cus_1' });
    expect(fetched.paymentMethod?.last4).toBe('4242');
  });

  it('refunds against the intent under the caller key', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const refund = await Effect.runPromise(
      payments.refund({ reference: 'pi_123', reason: 'order failed', idempotencyKey: 'payment-1' })
    );
    expect(refund.refundReference).toBe('re_1');
    expect(calls[0]!.params).toEqual([
      {
        payment_intent: 'pi_123',
        reason: 'requested_by_customer',
        metadata: { reason: 'order failed' }
      },
      { idempotencyKey: 'refund-payment-1' }
    ]);
  });
});

describe('verifyWebhook', () => {
  const payload = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'charge.refunded',
    data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_123' } }
  });
  const sign = (options: { secret?: string; timestamp?: number } = {}) =>
    Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: options.secret ?? WEBHOOK_SECRET,
      ...(options.timestamp ? { timestamp: options.timestamp } : {})
    });
  const payments = makeStripePayments({
    client: fakeStripe().client,
    webhookSecret: WEBHOOK_SECRET
  });

  it('accepts a correctly signed delivery and reduces it to routing ids', async () => {
    const event = await Effect.runPromise(payments.verifyWebhook(payload, await sign()));
    expect(event).toEqual({
      eventId: 'evt_1',
      type: 'charge.refunded',
      objectId: 'ch_1',
      paymentReference: 'pi_123',
      account: null
    });
  });

  it('refuses a tampered body', async () => {
    const header = await sign();
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload.replace('pi_123', 'pi_999'), header)
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a signature made with another secret', async () => {
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload, await sign({ secret: 'whsec_other' }))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a stale timestamp', async () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const exit = await Effect.runPromiseExit(
      payments.verifyWebhook(payload, await sign({ timestamp: anHourAgo }))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses everything when no webhook secret is configured', async () => {
    const unconfigured = makeStripePayments({ client: fakeStripe().client, webhookSecret: null });
    const exit = await Effect.runPromiseExit(unconfigured.verifyWebhook(payload, await sign()));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
