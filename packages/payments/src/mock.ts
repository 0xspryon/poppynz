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
            paymentMethod: mockCard(input.savedCard ?? `mock_pm_${input.idempotencyKey}`)
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
      const canceled = { ...payment, status: 'canceled' as const };
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
