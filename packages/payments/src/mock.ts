import { Context, Effect, Layer } from 'effect';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  Payments,
  quoteFromPolicy,
  type CardDetails,
  type PaymentOperation,
  type PaymentRefund,
  type ProviderCardSetup,
  type ProviderPayment,
  type StartPaymentInput
} from './port';

/** The card every mock setup and mock payment "uses". */
export const mockCard = (reference: string): CardDetails => ({
  reference,
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2034
});

/**
 * Mock provider.
 *
 * Payments succeed the moment they start and card setups succeed immediately
 * with a fake Visa •••• 4242, so the whole flow runs without a provider.
 * `failStart` and `failRefund` exist so the decline and refund paths can be
 * exercised — those are exactly the paths that are painful to test once money
 * is real. `verifyWebhook` accepts nothing: the mock has no webhooks.
 */
export const makeMockPayments = (
  options: {
    failStart?: boolean;
    failRefund?: boolean;
    /** Off-session charges and captures fail as if the provider were down. */
    providerDown?: boolean;
    now?: () => Date;
  } = {}
): Context.Tag.Service<Payments> => {
  const now = options.now ?? (() => new Date());
  const started = new Map<string, { input: StartPaymentInput; reference: string }>();
  const byReference = new Map<string, ProviderPayment>();
  const refunds = new Map<string, PaymentRefund>();
  const setups = new Map<string, ProviderCardSetup>();

  const unknown = (operation: PaymentOperation, reference: string) =>
    Effect.fail(
      new PaymentProviderError({ operation, cause: `mock: unknown reference ${reference}` })
    );

  return {
    provider: 'mock',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    startPayment: (input) =>
      Effect.gen(function* () {
        if (options.failStart) {
          return yield* Effect.fail(new PaymentDeclinedError({ reason: 'mock decline' }));
        }
        // Idempotency is part of the contract, not an implementation detail —
        // the mock has to honour it or the retry path tests nothing.
        const existing = started.get(input.idempotencyKey);
        const reference = existing?.reference ?? `mock_pi_${input.idempotencyKey}`;
        if (!existing) {
          started.set(input.idempotencyKey, { input, reference });
          byReference.set(reference, {
            reference,
            status: 'succeeded',
            amountCents: input.quote.totalCents,
            currency: input.quote.currency.toLowerCase(),
            metadata: { ...input.metadata },
            customer: input.customer ?? null,
            savesCard: input.saveCard,
            failureReason: null,
            receiptUrl: null,
            refundedCents: 0,
            paymentMethod: mockCard(input.savedCard ?? `mock_pm_${input.idempotencyKey}`),
            capturableCents: 0,
            receivedCents: input.quote.totalCents,
            captureBefore: null
          });
        }
        return {
          reference,
          clientSecret: `mock_secret_${reference}`,
          status: 'succeeded' as const,
          paymentMethodReference: input.savedCard ?? null
        };
      }),

    resumePayment: (reference) => {
      const payment = byReference.get(reference);
      return payment
        ? Effect.succeed({
            reference,
            clientSecret: `mock_secret_${reference}`,
            status: payment.status,
            paymentMethodReference: payment.paymentMethod?.reference ?? null
          })
        : unknown('resumePayment', reference);
    },

    getPayment: (reference) => {
      const payment = byReference.get(reference);
      return payment ? Effect.succeed(payment) : unknown('getPayment', reference);
    },

    cancelPayment: (reference) => {
      const payment = byReference.get(reference);
      if (!payment) return unknown('cancelPayment', reference);
      if (payment.status === 'succeeded') return Effect.succeed(payment);
      const canceled = { ...payment, status: 'canceled' as const, capturableCents: 0 };
      byReference.set(reference, canceled);
      return Effect.succeed(canceled);
    },

    refund: ({ reference, idempotencyKey }) =>
      Effect.gen(function* () {
        if (options.failRefund) {
          return yield* Effect.fail(
            new PaymentProviderError({ operation: 'refund', cause: 'mock refund failure' })
          );
        }
        const existing = refunds.get(idempotencyKey);
        if (existing) {
          return existing;
        }
        const refund: PaymentRefund = {
          refundReference: `mock_refund_${reference}`,
          refundedAt: now()
        };
        refunds.set(idempotencyKey, refund);
        return refund;
      }),

    ensureCustomer: ({ userId, existing }) => Effect.succeed(existing ?? `mock_cus_${userId}`),

    startCardSetup: (customer) => {
      const reference = `mock_seti_${setups.size + 1}`;
      setups.set(reference, {
        reference,
        status: 'succeeded',
        customer,
        paymentMethod: mockCard(`mock_pm_${reference}`)
      });
      return Effect.succeed({ reference, clientSecret: `mock_secret_${reference}` });
    },

    getCardSetup: (reference) => {
      const setup = setups.get(reference);
      return setup ? Effect.succeed(setup) : unknown('getCardSetup', reference);
    },

    removeCard: () => Effect.void,

    // Off-session contract billing. A saved card whose reference contains
    // `decline` is refused — the only way to reach the decline paths without
    // a provider. Same key → same intent, as everywhere else.
    chargeSavedCard: (input) =>
      Effect.suspend(() => {
        if (options.providerDown) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'chargeSavedCard', cause: 'mock provider down' })
          );
        }
        const existing = started.get(input.idempotencyKey);
        if (existing) return Effect.succeed(byReference.get(existing.reference)!);
        const reference = `mock_pi_${input.idempotencyKey}`;
        const declined = input.card.includes('decline');
        const payment: ProviderPayment = {
          reference,
          status: declined ? 'failed' : input.capture === 'manual' ? 'authorised' : 'succeeded',
          amountCents: input.amountCents,
          currency: input.currency.toLowerCase(),
          metadata: { ...input.metadata },
          customer: input.customer,
          savesCard: false,
          failureReason: declined ? 'Your card was declined.' : null,
          receiptUrl: null,
          refundedCents: 0,
          paymentMethod: mockCard(input.card),
          capturableCents: !declined && input.capture === 'manual' ? input.amountCents : 0,
          receivedCents: !declined && input.capture === 'automatic' ? input.amountCents : 0,
          captureBefore:
            input.capture === 'manual' ? new Date(now().getTime() + 114 * 60 * 60 * 1000) : null
        };
        started.set(input.idempotencyKey, {
          input: {
            quote: {
              amountCents: input.amountCents,
              lineItems: [],
              feeCents: 0,
              taxCents: 0,
              taxLines: [],
              totalCents: input.amountCents,
              currency: input.currency
            },
            idempotencyKey: input.idempotencyKey,
            metadata: input.metadata,
            customer: input.customer,
            savedCard: input.card,
            saveCard: false
          },
          reference
        });
        byReference.set(reference, payment);
        return Effect.succeed(payment);
      }),

    capturePayment: ({ reference, amountCents }) =>
      Effect.suspend(() => {
        if (options.providerDown) {
          return Effect.fail(
            new PaymentProviderError({ operation: 'capturePayment', cause: 'mock provider down' })
          );
        }
        const payment = byReference.get(reference);
        if (!payment) return unknown('capturePayment', reference);
        if (payment.status === 'succeeded') return Effect.succeed(payment);
        if (payment.status !== 'authorised') {
          return Effect.fail(
            new PaymentProviderError({
              operation: 'capturePayment',
              cause: `mock: ${reference} is ${payment.status}, not capturable`
            })
          );
        }
        const captured: ProviderPayment = {
          ...payment,
          status: 'succeeded',
          capturableCents: 0,
          receivedCents: Math.min(amountCents, payment.capturableCents)
        };
        byReference.set(reference, captured);
        return Effect.succeed(captured);
      }),

    findPaymentByRowId: (paymentId) =>
      options.providerDown
        ? Effect.fail(
            new PaymentProviderError({
              operation: 'findPaymentByRowId',
              cause: 'mock provider down'
            })
          )
        : Effect.sync(
            () =>
              [...byReference.values()].find(
                (payment) => payment.metadata.payment_id === paymentId
              ) ?? null
          ),

    // Payout accounts: enabled straight away, so the whole helper flow runs
    // without Stripe. The "hosted onboarding" is the return page itself.
    createPayoutAccount: ({ userId }) => Effect.succeed({ reference: `mock_acct_${userId}` }),

    createOnboardingLink: ({ returnUrl }) =>
      Effect.sync(() => ({
        url: returnUrl,
        expiresAt: new Date(now().getTime() + 5 * 60 * 1000)
      })),

    getPayoutAccount: () =>
      Effect.succeed({
        detailsSubmitted: true,
        payoutsEnabled: true,
        transfersActive: true,
        requirementsDue: [],
        disabledReason: null
      }),

    createDashboardLink: () => Effect.succeed({ url: 'about:blank' }),

    verifyWebhook: () =>
      Effect.fail(new PaymentWebhookSignatureError({ reason: 'the mock provider has no webhooks' }))
  };
};

export const PaymentsMock = Layer.sync(Payments, () => makeMockPayments());

export const makePaymentsTest = (implementation: Partial<Context.Tag.Service<Payments>>) =>
  Layer.succeed(Payments, { ...makeMockPayments(), ...implementation });
