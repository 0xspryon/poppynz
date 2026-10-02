import { Context, Data, Effect } from 'effect';

/**
 * The seam Stripe plugs into.
 *
 * Nothing outside this package may import Stripe — that rule is why the
 * persisted columns are `provider` + `provider_reference` rather than
 * `stripe_*`, and why every operation here speaks in references and cents.
 *
 * Payment is TWO-STEP. `startPayment` creates the provider's intent and hands
 * back a client secret for the browser to confirm (3-D Secure included); money
 * is only ever recorded as taken by a server-side re-fetch (`getPayment`),
 * never by the browser saying so. The mock settles instantly so the ordering,
 * refund and retry paths stay exercised without a provider.
 *
 * Three properties matter more than the provider:
 *
 *   - A quote is ITEMISED and frozen. The caller stores the breakdown in cents
 *     and never recomputes it for display.
 *   - Starting a payment is IDEMPOTENT on a caller-supplied key, so a retried
 *     order can't create a second charge.
 *   - Refund exists from day one, keyed the same way.
 */

/** Which gateway a reference belongs to. Persisted next to the reference so a
 * row is meaningful on its own. */
export type PaymentProvider = 'mock' | 'stripe';

/** One priced line on a quote. */
export type QuoteLineItem = {
  readonly label: string;
  readonly costCents: number;
};

/** Fee and tax policy for one purpose. Pre-tax, in cents and basis points. */
export type QuotePolicy = {
  readonly adminFeeCents: number;
  readonly taxRateBasisPoints: number;
};

export type Money = {
  /** Sum of the selected checks, pre-tax. */
  readonly amountCents: number;
  readonly lineItems: ReadonlyArray<QuoteLineItem>;
  /** Poppynz administration fee, pre-tax. */
  readonly feeCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  readonly currency: 'CAD';
};

/** A provider-side status, normalised. `failed` is an attempt that was
 * declined and left waiting for another card; `canceled` is terminal. */
export type ProviderPaymentStatus =
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/** Display details of a card plus its provider reference. Never a full
 * number — the provider holds the card. */
export type CardDetails = {
  readonly reference: string;
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
};

export type StartedPayment = {
  /** Opaque to everything above this port (a PaymentIntent id for Stripe). */
  readonly reference: string;
  /** Handed to the browser so it can confirm the payment. Never stored. */
  readonly clientSecret: string;
  readonly status: ProviderPaymentStatus;
  /** The card already attached to the intent (a family's saved card), if any. */
  readonly paymentMethodReference: string | null;
};

/** What the provider says about a payment, re-fetched — the only thing the
 * settle path acts on. */
export type ProviderPayment = {
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  readonly amountCents: number;
  /** Lower-case ISO code as the provider reports it, e.g. `cad`. */
  readonly currency: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly customer: string | null;
  /** True when the intent was created to keep the card for later. */
  readonly savesCard: boolean;
  readonly failureReason: string | null;
  readonly receiptUrl: string | null;
  readonly refundedCents: number;
  readonly paymentMethod: CardDetails | null;
};

export type PaymentRefund = {
  readonly refundReference: string;
  readonly refundedAt: Date;
};

export type CardSetup = {
  readonly reference: string;
  readonly clientSecret: string;
};

export type ProviderCardSetup = {
  readonly reference: string;
  readonly status: ProviderPaymentStatus;
  readonly customer: string | null;
  readonly paymentMethod: CardDetails | null;
};

/** A helper's payout account as the provider reports it, normalised. Always
 * re-fetched — a webhook only says "something changed", never what. */
export type PayoutAccountSnapshot = {
  readonly detailsSubmitted: boolean;
  readonly payoutsEnabled: boolean;
  /** The `transfers` capability is `active`. */
  readonly transfersActive: boolean;
  /** Provider requirement codes due now or past due, deduplicated. */
  readonly requirementsDue: ReadonlyArray<string>;
  readonly disabledReason: string | null;
};

export type PayoutAccountCreated = {
  /** The connected account id (`acct_…` on Stripe). */
  readonly reference: string;
};

/** A single-use hosted-onboarding URL. Short-lived; never stored. */
export type OnboardingLink = {
  readonly url: string;
  readonly expiresAt: Date;
};

export type DashboardLink = {
  readonly url: string;
};

/** A verified webhook delivery, reduced to what routing needs. The payload's
 * object is never acted on — callers re-fetch by reference. */
export type PaymentWebhookEvent = {
  readonly eventId: string;
  readonly type: string;
  readonly objectId: string;
  /** For charge and dispute events, the PaymentIntent the object belongs to. */
  readonly paymentReference: string | null;
  /** The connected account, for Connect events (piece 2b). */
  readonly account: string | null;
};

export type PaymentOperation =
  | 'startPayment'
  | 'resumePayment'
  | 'getPayment'
  | 'cancelPayment'
  | 'refund'
  | 'ensureCustomer'
  | 'startCardSetup'
  | 'getCardSetup'
  | 'removeCard'
  | 'verifyWebhook'
  | 'createPayoutAccount'
  | 'createOnboardingLink'
  | 'getPayoutAccount'
  | 'createDashboardLink';

export class PaymentDeclinedError extends Data.TaggedError('PaymentDeclinedError')<{
  reason: string;
}> {}

export class PaymentProviderError extends Data.TaggedError('PaymentProviderError')<{
  operation: PaymentOperation;
  cause: unknown;
}> {}

export class PaymentWebhookSignatureError extends Data.TaggedError('PaymentWebhookSignatureError')<{
  reason: string;
}> {}

export type StartPaymentInput = {
  quote: Money;
  /** Same key must produce the same intent, never a second charge. */
  idempotencyKey: string;
  /** `payment_id` is always our `payments.id`; the settle path checks it. */
  metadata: { payment_id: string } & Record<string, string>;
  /** Provider customer reference (families only). */
  customer?: string | null;
  /** Saved card reference to pre-attach for one-click payment. */
  savedCard?: string | null;
  /** Keep the card for off-session use (a family's first card). */
  saveCard: boolean;
};

export class Payments extends Context.Tag('@repo/payments/Payments')<
  Payments,
  {
    readonly provider: PaymentProvider;
    /** Itemises what somebody will pay before anything is charged. */
    quote: (lineItems: ReadonlyArray<QuoteLineItem>, policy: QuotePolicy) => Effect.Effect<Money>;
    startPayment: (
      input: StartPaymentInput
    ) => Effect.Effect<StartedPayment, PaymentDeclinedError | PaymentProviderError>;
    /** A fresh client secret for an unfinished intent — never a second intent. */
    resumePayment: (reference: string) => Effect.Effect<StartedPayment, PaymentProviderError>;
    getPayment: (reference: string) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    /** Cancels an unfinished intent and returns its state afterwards. An
     * intent that already succeeded comes back as `succeeded`, untouched. */
    cancelPayment: (reference: string) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    refund: (input: {
      reference: string;
      reason: string;
      /** Same key must resolve to the same refund, never a second one. */
      idempotencyKey: string;
    }) => Effect.Effect<PaymentRefund, PaymentProviderError>;
    /** The provider customer for a paying user, created when `existing` is null. */
    ensureCustomer: (input: {
      userId: string;
      email: string;
      name: string;
      existing: string | null;
    }) => Effect.Effect<string, PaymentProviderError>;
    startCardSetup: (customer: string) => Effect.Effect<CardSetup, PaymentProviderError>;
    getCardSetup: (reference: string) => Effect.Effect<ProviderCardSetup, PaymentProviderError>;
    /** Detaches a card from its customer. */
    removeCard: (cardReference: string) => Effect.Effect<void, PaymentProviderError>;
    /** Creates the helper's connected account. Same user → same account
     * (idempotency key `payout-account:<userId>`). */
    createPayoutAccount: (input: {
      userId: string;
      email: string;
    }) => Effect.Effect<PayoutAccountCreated, PaymentProviderError>;
    /** Hosted onboarding for an existing account. */
    createOnboardingLink: (input: {
      reference: string;
      returnUrl: string;
      refreshUrl: string;
    }) => Effect.Effect<OnboardingLink, PaymentProviderError>;
    getPayoutAccount: (reference: string) => Effect.Effect<PayoutAccountSnapshot, PaymentProviderError>;
    /** A login link to the provider's payout dashboard. */
    createDashboardLink: (reference: string) => Effect.Effect<DashboardLink, PaymentProviderError>;
    verifyWebhook: (
      rawBody: string,
      signatureHeader: string | null
    ) => Effect.Effect<PaymentWebhookEvent, PaymentWebhookSignatureError>;
  }
>() {}

export const quoteFromPolicy = (
  lineItems: ReadonlyArray<QuoteLineItem>,
  policy: QuotePolicy
): Money => {
  const amountCents = lineItems.reduce((total, item) => total + item.costCents, 0);
  // An empty basket is quoted as nothing at all — charging the administration
  // fee on zero checks would bill somebody for ordering nothing.
  const feeCents = lineItems.length === 0 ? 0 : policy.adminFeeCents;
  const taxable = amountCents + feeCents;
  // Integer arithmetic throughout — a float here shows up as a cent that
  // doesn't reconcile.
  const taxCents = Math.round((taxable * policy.taxRateBasisPoints) / 10_000);

  return {
    amountCents,
    lineItems,
    feeCents,
    taxCents,
    totalCents: taxable + taxCents,
    currency: 'CAD'
  };
};
