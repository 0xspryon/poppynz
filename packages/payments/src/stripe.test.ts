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

const refundObject = (overrides: Record<string, unknown> = {}) => ({
  id: 're_2',
  object: 'refund',
  amount: 5039,
  status: 'succeeded',
  payment_intent: 'pi_123',
  metadata: { refund_id: 'refund-1' },
  failure_reason: null,
  created: 1_790_000_000,
  ...overrides
});

const transferObject = (overrides: Record<string, unknown> = {}) => ({
  id: 'tr_1',
  object: 'transfer',
  amount: 10531,
  destination: 'acct_1',
  source_transaction: 'ch_1',
  metadata: { cycle_id: 'cycle-1' },
  amount_reversed: 0,
  created: 1_790_000_000,
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
    capture?: () => unknown;
    search?: () => unknown;
    setupCreate?: () => unknown;
    setupRetrieve?: () => unknown;
    refundCreate?: () => unknown;
    refundRetrieve?: () => unknown;
    transferCreate?: () => unknown;
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
      cancel: record('paymentIntents.cancel', answers.cancel ?? (() => intent())),
      search: record('paymentIntents.search', answers.search ?? (() => ({ data: [] }))),
      capture: (first: unknown, second: unknown, third: unknown) => {
        calls.push({ method: 'paymentIntents.capture', params: [first, [second, third]] });
        return Promise.resolve((answers.capture ?? (() => intent()))() as never);
      }
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
    refunds: {
      create: record(
        'refunds.create',
        answers.refundCreate ?? (() => ({ id: 're_1', created: 1_790_000_000 }))
      ),
      retrieve: record('refunds.retrieve', answers.refundRetrieve ?? (() => refundObject()))
    },
    transfers: {
      create: record('transfers.create', answers.transferCreate ?? (() => transferObject())),
      retrieve: record('transfers.retrieve', () => transferObject())
    },
    payouts: {
      retrieve: (first: unknown, second: unknown, third: unknown) => {
        calls.push({ method: 'payouts.retrieve', params: [first, [second, third]] });
        return Promise.resolve({
          id: 'po_1',
          status: 'paid',
          amount: 5000,
          arrival_date: 1_790_100_000,
          created: 1_790_000_000,
          failure_message: null,
          failure_code: null
        } as never);
      }
    },
    // The real verifier: signatures are what this suite is about.
    webhooks: Stripe.webhooks
  } as unknown as StripeApi;
  return { client, calls };
};

const quote = quoteFromPolicy([{ label: 'Check', costCents: 7000 }], {
  adminFeeCents: 500,
  taxLines: []
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
    // A hold waiting for capture (contract billing).
    expect(normaliseStatus('requires_capture', false)).toBe('authorised');
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
      },
      capturableCents: 0,
      receivedCents: 0,
      captureBefore: null,
      chargeReference: expect.anything()
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

  it('treats a blank secret as unset, so nobody can sign with a known empty key', async () => {
    // A caller passing '' or whitespace must not get an HMAC check against
    // that publicly known key (defence in depth: PaymentsLive also filters).
    const blankSigned = (secret: string) =>
      Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    const blankPlatform = makeStripePayments({ client: fakeStripe().client, webhookSecret: ' ' });
    const platformExit = await Effect.runPromiseExit(
      blankPlatform.verifyWebhook(payload, await blankSigned(' '))
    );
    expect(Exit.isFailure(platformExit)).toBe(true);

    const blankConnect = makeStripePayments({
      client: fakeStripe().client,
      webhookSecret: WEBHOOK_SECRET,
      connectWebhookSecret: '  '
    });
    const connectExit = await Effect.runPromiseExit(
      blankConnect.verifyWebhook(payload, await blankSigned('  '))
    );
    expect(Exit.isFailure(connectExit)).toBe(true);
    // The platform secret still works alongside the ignored blank one.
    expect(
      Exit.isSuccess(await Effect.runPromiseExit(blankConnect.verifyWebhook(payload, await sign())))
    ).toBe(true);
  });

  it('accepts a Connect event signed with the Connect endpoint secret, keeping its account', async () => {
    const connectPayload = JSON.stringify({
      id: 'evt_2',
      object: 'event',
      type: 'account.updated',
      account: 'acct_123',
      data: { object: { id: 'acct_123', object: 'account' } }
    });
    const header = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload: connectPayload,
      secret: 'whsec_connect'
    });
    const withConnect = makeStripePayments({
      client: fakeStripe().client,
      webhookSecret: WEBHOOK_SECRET,
      connectWebhookSecret: 'whsec_connect'
    });
    expect(await Effect.runPromise(withConnect.verifyWebhook(connectPayload, header))).toEqual({
      eventId: 'evt_2',
      type: 'account.updated',
      objectId: 'acct_123',
      paymentReference: null,
      account: 'acct_123'
    });
    // Without the Connect secret configured, the same delivery is refused.
    const exit = await Effect.runPromiseExit(payments.verifyWebhook(connectPayload, header));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('chargeSavedCard', () => {
  const input = {
    amountCents: 63390,
    currency: 'CAD' as const,
    customer: 'cus_1',
    card: 'pm_saved',
    capture: 'manual' as const,
    idempotencyKey: 'cycle-c1-1',
    metadata: { payment_id: 'payment-9', cycle_id: 'c1' },
    description: 'Care with Sam T. · Nov 2–4, 2026'
  };

  it('places an off-session hold on the saved card under the cycle key', async () => {
    const { client, calls } = fakeStripe({
      create: () =>
        intent({
          status: 'requires_capture',
          amount: 63390,
          amount_capturable: 63390,
          payment_method: card,
          latest_charge: {
            id: 'ch_1',
            receipt_url: null,
            amount_refunded: 0,
            payment_method_details: { card: { capture_before: 1_793_000_000 } }
          }
        })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.chargeSavedCard(input));

    expect(result).toMatchObject({
      status: 'authorised',
      capturableCents: 63390,
      captureBefore: new Date(1_793_000_000 * 1000)
    });
    const [params, options] = calls[0]!.params as [Record<string, unknown>, unknown];
    expect(params).toEqual({
      amount: 63390,
      currency: 'cad',
      customer: 'cus_1',
      payment_method: 'pm_saved',
      allowed_payment_method_types: ['card'],
      off_session: true,
      confirm: true,
      capture_method: 'manual',
      metadata: { payment_id: 'payment-9', cycle_id: 'c1' },
      description: 'Care with Sam T. · Nov 2–4, 2026',
      expand: ['latest_charge', 'payment_method']
    });
    expect(options).toEqual({ idempotencyKey: 'charge-cycle-c1-1' });
  });

  it('charges at once with automatic capture', async () => {
    const { client, calls } = fakeStripe({
      create: () => intent({ status: 'succeeded', amount: 63390, amount_received: 63390 })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(
      payments.chargeSavedCard({ ...input, capture: 'automatic' })
    );
    expect(result).toMatchObject({ status: 'succeeded', receivedCents: 63390 });
    expect((calls[0]!.params[0] as Record<string, unknown>).capture_method).toBe('automatic');
  });

  it('returns a decline as data, with the intent Stripe attached to the error', async () => {
    const { client } = fakeStripe({
      create: () => {
        throw new Stripe.errors.StripeCardError({
          message: 'Your card was declined.',
          payment_intent: intent({
            id: 'pi_declined',
            status: 'requires_payment_method',
            last_payment_error: { message: 'Your card was declined.' }
          })
        } as never);
      }
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.chargeSavedCard(input));
    expect(result).toMatchObject({
      reference: 'pi_declined',
      status: 'failed',
      failureReason: 'Your card was declined.'
    });
  });

  it('treats an intent that needs 3-D Secure off-session as declined', async () => {
    const { client } = fakeStripe({ create: () => intent({ status: 'requires_action' }) });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(payments.chargeSavedCard(input));
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('confirm');
  });

  it('fails with a provider error when Stripe itself is in trouble', async () => {
    const { client } = fakeStripe({
      create: () => {
        throw new Stripe.errors.StripeAPIError({ message: 'boom' });
      }
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const exit = await Effect.runPromiseExit(payments.chargeSavedCard(input));
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'PaymentProviderError',
          operation: 'chargeSavedCard'
        }) as never
      )
    );
  });
});

describe('chargeSavedCard idempotency refusals (R4)', () => {
  const input = {
    amountCents: 63390,
    currency: 'CAD' as const,
    customer: 'cus_1',
    card: 'pm_new',
    capture: 'manual' as const,
    idempotencyKey: 'cycle-c1-1',
    metadata: { payment_id: 'payment-9' }
  };

  it('marks a key reused with different parameters as an idempotency mismatch', async () => {
    const { client } = fakeStripe({
      create: () => {
        throw new Stripe.errors.StripeIdempotencyError({
          type: 'idempotency_error',
          message: 'Keys for idempotent requests can only be used with the same parameters.'
        } as never);
      }
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const exit = await Effect.runPromiseExit(payments.chargeSavedCard(input));
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'PaymentProviderError',
          idempotency: 'mismatch'
        }) as never
      )
    );
  });

  it('marks a key whose first request is still running as in flight', async () => {
    const { client } = fakeStripe({
      create: () => {
        throw new Stripe.errors.StripeInvalidRequestError({
          code: 'idempotency_key_in_use',
          message: 'There is currently another in-progress request using this key.'
        } as never);
      }
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const exit = await Effect.runPromiseExit(payments.chargeSavedCard(input));
    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'PaymentProviderError', idempotency: 'in_flight' }) as never
      )
    );
  });

  it('leaves an ordinary outage unmarked', async () => {
    const { client } = fakeStripe({
      create: () => {
        throw new Stripe.errors.StripeConnectionError({ message: 'socket hang up' } as never);
      }
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const exit = await Effect.runPromiseExit(payments.chargeSavedCard(input));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
      expect((exit.cause.error as { idempotency?: string }).idempotency).toBeUndefined();
    }
  });
});

describe('capturePayment', () => {
  it('captures the amount asked for under the capture key', async () => {
    const { client, calls } = fakeStripe({
      capture: () => intent({ status: 'succeeded', amount: 63390, amount_received: 50000 })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(
      payments.capturePayment({ reference: 'pi_123', amountCents: 50000, idempotencyKey: 'c1' })
    );
    expect(result).toMatchObject({ status: 'succeeded', receivedCents: 50000 });
    expect(calls[0]).toEqual({
      method: 'paymentIntents.capture',
      params: [
        'pi_123',
        [
          { amount_to_capture: 50000, expand: ['latest_charge', 'payment_method'] },
          { idempotencyKey: 'capture-c1' }
        ]
      ]
    });
  });
});

describe('findPaymentByRowId', () => {
  it('searches intents by the payment row id in their metadata', async () => {
    const { client, calls } = fakeStripe({
      search: () => ({ data: [intent({ status: 'requires_capture', amount_capturable: 7500 })] })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const found = await Effect.runPromise(payments.findPaymentByRowId('payment-1'));
    expect(found).toMatchObject({ reference: 'pi_123', status: 'authorised' });
    expect(calls[0]).toEqual({
      method: 'paymentIntents.search',
      params: [
        {
          query: "metadata['payment_id']:'payment-1'",
          expand: ['data.latest_charge', 'data.payment_method']
        },
        undefined
      ]
    });
  });

  it('answers null when no intent was ever created for the row', async () => {
    const { client } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    expect(await Effect.runPromise(payments.findPaymentByRowId('payment-9'))).toBeNull();
  });
});

describe('partial refunds (Tier 3 step 2)', () => {
  it('refunds part of the intent under our refund id, with its metadata', async () => {
    const { client, calls } = fakeStripe({
      refundCreate: () => refundObject({ status: 'pending' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const refund = await Effect.runPromise(
      payments.createRefund({
        paymentReference: 'pi_123',
        amountCents: 5039,
        idempotencyKey: 'refund-1',
        metadata: { refund_id: 'refund-1', session_id: 's-1', cycle_id: 'c-1' }
      })
    );
    expect(refund).toMatchObject({
      reference: 're_2',
      status: 'pending',
      amountCents: 5039,
      paymentReference: 'pi_123'
    });
    expect(calls[0]).toEqual({
      method: 'refunds.create',
      params: [
        {
          payment_intent: 'pi_123',
          amount: 5039,
          reason: 'requested_by_customer',
          metadata: { refund_id: 'refund-1', session_id: 's-1', cycle_id: 'c-1' }
        },
        { idempotencyKey: 'refund-1' }
      ]
    });
  });

  it('reports a refund Stripe refuses as a refusal, an outage as an outage', async () => {
    const refusing = fakeStripe({
      refundCreate: () => {
        throw new Stripe.errors.StripeInvalidRequestError({
          message: 'Refund amount ($20.00) is greater than unrefunded amount on charge ($15.65)'
        } as never);
      }
    });
    const input = {
      paymentReference: 'pi_123',
      amountCents: 2000,
      idempotencyKey: 'refund-1',
      metadata: {}
    };
    const refused = await Effect.runPromise(
      makeStripePayments({ client: refusing.client, webhookSecret: WEBHOOK_SECRET })
        .createRefund(input)
        .pipe(Effect.flip)
    );
    expect(refused.refusal).toContain('greater than unrefunded amount');
    const down = fakeStripe({
      refundCreate: () => {
        throw new Stripe.errors.StripeConnectionError({ message: 'down' } as never);
      }
    });
    const outage = await Effect.runPromise(
      makeStripePayments({ client: down.client, webhookSecret: WEBHOOK_SECRET })
        .createRefund(input)
        .pipe(Effect.flip)
    );
    expect(outage.refusal).toBeUndefined();
  });

  it('reports a failed refund with its reason on re-fetch', async () => {
    const { client } = fakeStripe({
      refundRetrieve: () =>
        refundObject({ status: 'failed', failure_reason: 'expired_or_canceled_card' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const refund = await Effect.runPromise(payments.getRefund('re_2'));
    expect(refund).toMatchObject({ status: 'failed', failureReason: 'expired_or_canceled_card' });
  });
});

describe('transfers and payouts (Tier 3 step 2)', () => {
  it('transfers to the connected account from the cycle charge, keyed by the caller', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const result = await Effect.runPromise(
      payments.createTransfer({
        amountCents: 10531,
        currency: 'CAD',
        destination: 'acct_1',
        sourceTransaction: 'ch_1',
        idempotencyKey: 'transfer-cycle-1',
        metadata: { cycle_id: 'cycle-1' }
      })
    );
    expect(result).toMatchObject({
      status: 'created',
      transfer: { reference: 'tr_1', sourceTransaction: 'ch_1' }
    });
    expect(calls[0]).toEqual({
      method: 'transfers.create',
      params: [
        {
          amount: 10531,
          currency: 'cad',
          destination: 'acct_1',
          source_transaction: 'ch_1',
          metadata: { cycle_id: 'cycle-1' }
        },
        { idempotencyKey: 'transfer-cycle-1' }
      ]
    });
  });

  it('a transfer Stripe refuses is data; a connection failure is an error', async () => {
    const refused = makeStripePayments({
      client: fakeStripe({
        transferCreate: () => {
          throw new Stripe.errors.StripeInvalidRequestError({
            message: 'Insufficient funds in Stripe account.',
            type: 'invalid_request_error'
          } as never);
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const input = {
      amountCents: 100,
      currency: 'CAD' as const,
      destination: 'acct_1',
      sourceTransaction: null,
      idempotencyKey: 'k',
      metadata: {}
    };
    expect(await Effect.runPromise(refused.createTransfer(input))).toEqual({
      status: 'refused',
      reason: 'Insufficient funds in Stripe account.'
    });
    const down = makeStripePayments({
      client: fakeStripe({
        transferCreate: () => {
          throw new Stripe.errors.StripeConnectionError({ message: 'down' } as never);
        }
      }).client,
      webhookSecret: WEBHOOK_SECRET
    });
    const exit = await Effect.runPromiseExit(down.createTransfer(input));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('re-fetches a payout on the connected account', async () => {
    const { client, calls } = fakeStripe();
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    const payout = await Effect.runPromise(
      payments.getPayout({ account: 'acct_1', reference: 'po_1' })
    );
    expect(payout).toMatchObject({ status: 'paid', amountCents: 5000 });
    expect(calls[0]).toEqual({
      method: 'payouts.retrieve',
      params: ['po_1', [{}, { stripeAccount: 'acct_1' }]]
    });
  });

  it('exposes the charge of an intent (the transfer source)', async () => {
    const { client } = fakeStripe({
      retrieve: () => intent({ status: 'succeeded', latest_charge: 'ch_9' })
    });
    const payments = makeStripePayments({ client, webhookSecret: WEBHOOK_SECRET });
    expect((await Effect.runPromise(payments.getPayment('pi_123'))).chargeReference).toBe('ch_9');
  });
});
