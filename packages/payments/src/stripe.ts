import Stripe from 'stripe';
import { Context, Effect } from 'effect';
import {
  PaymentDeclinedError,
  PaymentProviderError,
  PaymentWebhookSignatureError,
  quoteFromPolicy,
  type CardDetails,
  type PaymentOperation,
  type Payments,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type StartedPayment
} from './port';
import { makeStripeConnectOperations, type StripeConnectClient } from './stripe-connect';

/**
 * Stripe adapter for the `Payments` port. The ONLY file in the monorepo that
 * imports `stripe`.
 *
 * Cards only, automatic capture, test mode only (the layer refuses a live
 * key). The client is injected so tests run against a fake.
 */

/** The API version this adapter was written against — the one pinned by the
 * installed SDK (stripe@23.0.0). Bumping the SDK means re-reading this file. */
export const STRIPE_API_VERSION = '2026-09-30.endive' as const;

/** The slice of the SDK this adapter uses. Narrow on purpose: a test fake only
 * has to implement these methods. */
export type StripeApi = {
  paymentIntents: Pick<Stripe['paymentIntents'], 'create' | 'retrieve' | 'cancel'>;
  setupIntents: Pick<Stripe['setupIntents'], 'create' | 'retrieve'>;
  customers: Pick<Stripe['customers'], 'create'>;
  paymentMethods: Pick<Stripe['paymentMethods'], 'detach'>;
  refunds: Pick<Stripe['refunds'], 'create'>;
  webhooks: Pick<Stripe['webhooks'], 'constructEventAsync'>;
} & StripeConnectClient;

export const makeStripeClient = (secretKey: string): StripeApi =>
  new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    appInfo: { name: 'poppynz' }
  });

const providerError = (operation: PaymentOperation) => (cause: unknown) =>
  new PaymentProviderError({ operation, cause });

const call = <A>(operation: PaymentOperation, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: providerError(operation) });

/** Stripe's seven intent statuses, folded into the port's five. A
 * `requires_payment_method` intent with an error on it is a declined attempt;
 * without one it is simply waiting for a card. */
export const normaliseStatus = (status: string, hasError: boolean): ProviderPaymentStatus => {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'canceled':
      return 'canceled';
    case 'requires_payment_method':
      return hasError ? 'failed' : 'requires_action';
    default:
      // requires_action, requires_confirmation, requires_capture (never used —
      // capture is automatic) and anything Stripe adds later.
      return 'requires_action';
  }
};

const idOf = (value: string | { id: string } | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.id;

export const cardDetails = (method: string | Stripe.PaymentMethod | null): CardDetails | null => {
  if (method === null || typeof method === 'string' || !method.card) return null;
  return {
    reference: method.id,
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year
  };
};

export const normalisePaymentIntent = (intent: Stripe.PaymentIntent): ProviderPayment => {
  const charge =
    intent.latest_charge !== null && typeof intent.latest_charge !== 'string'
      ? intent.latest_charge
      : null;
  return {
    reference: intent.id,
    status: normaliseStatus(intent.status, intent.last_payment_error !== null),
    amountCents: intent.amount,
    currency: intent.currency,
    metadata: { ...intent.metadata },
    customer: idOf(intent.customer),
    savesCard: intent.setup_future_usage === 'off_session',
    failureReason: intent.last_payment_error?.message ?? null,
    receiptUrl: charge?.receipt_url ?? null,
    refundedCents: charge?.amount_refunded ?? 0,
    paymentMethod: cardDetails(intent.payment_method)
  };
};

const started =
  (operation: PaymentOperation) =>
  (intent: Stripe.PaymentIntent): Effect.Effect<StartedPayment, PaymentProviderError> =>
    intent.client_secret
      ? Effect.succeed({
          reference: intent.id,
          clientSecret: intent.client_secret,
          status: normaliseStatus(intent.status, intent.last_payment_error !== null),
          paymentMethodReference: idOf(intent.payment_method)
        })
      : Effect.fail(
          new PaymentProviderError({
            operation,
            cause: `PaymentIntent ${intent.id} has no client secret`
          })
        );

/** Fields the settle path needs in one round trip. */
const PAYMENT_EXPAND = ['latest_charge', 'payment_method'];

/** Stripe refuses to cancel an intent that already succeeded. */
const isUnexpectedState = (cause: unknown) =>
  cause instanceof Stripe.errors.StripeInvalidRequestError &&
  cause.code === 'payment_intent_unexpected_state';

/** Webhook payloads are routed by id only; this is the shape we read. */
type RoutedObject = { id?: unknown; payment_intent?: unknown };

export const makeStripePayments = (options: {
  client: StripeApi;
  /** Null when STRIPE_WEBHOOK_SECRET is unset: every delivery is then refused. */
  webhookSecret: string | null;
}): Context.Tag.Service<Payments> => {
  const { client, webhookSecret } = options;

  const retrieve = (operation: PaymentOperation, reference: string) =>
    call(operation, () =>
      client.paymentIntents.retrieve(reference, { expand: PAYMENT_EXPAND })
    ).pipe(Effect.map(normalisePaymentIntent));

  return {
    provider: 'stripe',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    startPayment: (input) =>
      call('startPayment', () =>
        client.paymentIntents.create(
          {
            amount: input.quote.totalCents,
            currency: input.quote.currency.toLowerCase(),
            // Cards only: no redirect-based methods, so 3-D Secure is the
            // only extra step and it happens in the modal.
            allowed_payment_method_types: ['card'],
            capture_method: 'automatic',
            metadata: input.metadata,
            ...(input.customer ? { customer: input.customer } : {}),
            ...(input.savedCard ? { payment_method: input.savedCard } : {}),
            ...(input.saveCard ? { setup_future_usage: 'off_session' as const } : {})
          },
          { idempotencyKey: `payment-${input.idempotencyKey}` }
        )
      ).pipe(
        // A saved card can be declined at creation; anything else is the
        // provider's problem, not the card's.
        Effect.mapError((error) =>
          error.cause instanceof Stripe.errors.StripeCardError
            ? new PaymentDeclinedError({ reason: error.cause.message })
            : error
        ),
        Effect.flatMap(started('startPayment'))
      ),

    resumePayment: (reference) =>
      call('resumePayment', () => client.paymentIntents.retrieve(reference)).pipe(
        Effect.flatMap(started('resumePayment'))
      ),

    getPayment: (reference) => retrieve('getPayment', reference),

    cancelPayment: (reference) =>
      call('cancelPayment', () =>
        client.paymentIntents.cancel(reference, { expand: PAYMENT_EXPAND })
      ).pipe(
        Effect.map(normalisePaymentIntent),
        // Already finished (succeeded or canceled): report what it is now.
        Effect.catchIf(
          (error) => isUnexpectedState(error.cause),
          () => retrieve('cancelPayment', reference)
        )
      ),

    refund: ({ reference, reason, idempotencyKey }) =>
      call('refund', () =>
        client.refunds.create(
          {
            payment_intent: reference,
            reason: 'requested_by_customer',
            metadata: { reason: reason.slice(0, 500) }
          },
          { idempotencyKey: `refund-${idempotencyKey}` }
        )
      ).pipe(
        Effect.map((refund) => ({
          refundReference: refund.id,
          refundedAt: new Date(refund.created * 1000)
        }))
      ),

    ensureCustomer: ({ userId, email, name, existing }) =>
      existing !== null
        ? Effect.succeed(existing)
        : call('ensureCustomer', () =>
            client.customers.create(
              { email, name, metadata: { user_id: userId } },
              // One customer per user even if two requests race here.
              { idempotencyKey: `customer-${userId}` }
            )
          ).pipe(Effect.map((customer) => customer.id)),

    startCardSetup: (customer) =>
      call('startCardSetup', () =>
        client.setupIntents.create({
          customer,
          usage: 'off_session',
          allowed_payment_method_types: ['card']
        })
      ).pipe(
        Effect.flatMap((intent) =>
          intent.client_secret
            ? Effect.succeed({ reference: intent.id, clientSecret: intent.client_secret })
            : Effect.fail(
                new PaymentProviderError({
                  operation: 'startCardSetup',
                  cause: `SetupIntent ${intent.id} has no client secret`
                })
              )
        )
      ),

    getCardSetup: (reference) =>
      call('getCardSetup', () =>
        client.setupIntents.retrieve(reference, { expand: ['payment_method'] })
      ).pipe(
        Effect.map((intent) => ({
          reference: intent.id,
          status: normaliseStatus(intent.status, intent.last_setup_error !== null),
          customer: idOf(intent.customer),
          paymentMethod: cardDetails(intent.payment_method)
        }))
      ),

    removeCard: (cardReference) =>
      call('removeCard', () => client.paymentMethods.detach(cardReference)).pipe(Effect.asVoid),

    // Helper payout accounts (Stripe Connect Express, piece 2b).
    ...makeStripeConnectOperations(client),

    verifyWebhook: (rawBody, signatureHeader) =>
      Effect.gen(function* () {
        if (webhookSecret === null) {
          return yield* Effect.fail(
            new PaymentWebhookSignatureError({ reason: 'STRIPE_WEBHOOK_SECRET is not set' })
          );
        }
        if (!signatureHeader) {
          return yield* Effect.fail(
            new PaymentWebhookSignatureError({ reason: 'missing Stripe-Signature header' })
          );
        }
        // The async variant: under Bun the SDK resolves to its web build, whose
        // SubtleCrypto provider cannot verify synchronously.
        const event = yield* Effect.tryPromise({
          try: () => client.webhooks.constructEventAsync(rawBody, signatureHeader, webhookSecret),
          catch: (cause) =>
            new PaymentWebhookSignatureError({
              reason: cause instanceof Error ? cause.message : 'invalid signature'
            })
        });
        const object = event.data.object as RoutedObject;
        return {
          eventId: event.id,
          type: event.type,
          objectId: typeof object.id === 'string' ? object.id : '',
          paymentReference:
            typeof object.payment_intent === 'string' ? object.payment_intent : null,
          account: event.account ?? null
        };
      })
  };
};
