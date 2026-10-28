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

/** One frozen tax line, resolved by the caller from the tax configuration
 * (`@repo/billing/pricing`) — this port never decides tax. */
export type QuoteTaxLine = {
  readonly supplyType: string;
  readonly jurisdiction: string;
  readonly component: string;
  readonly rateMillipercent: number;
  readonly baseCents: number;
  readonly taxCents: number;
  /** "HST (ON) 13%". */
  readonly label: string;
  readonly registrationNumber: string | null;
};

/** Fee and tax for one purpose, pre-tax fee in cents. `taxLines` were
 * resolved for exactly these line items and this fee. */
export type QuotePolicy = {
  readonly adminFeeCents: number;
  readonly taxLines: ReadonlyArray<QuoteTaxLine>;
};

export type Money = {
  /** Sum of the selected checks, pre-tax. */
  readonly amountCents: number;
  readonly lineItems: ReadonlyArray<QuoteLineItem>;
  /** Poppynz administration fee, pre-tax. */
  readonly feeCents: number;
  /** The sum of `taxLines`. */
  readonly taxCents: number;
  readonly taxLines: ReadonlyArray<QuoteTaxLine>;
  readonly totalCents: number;
  readonly currency: 'CAD';
};

/** A provider-side status, normalised. `failed` is an attempt that was
 * declined and left waiting for another card; `canceled` is terminal;
 * `authorised` is a hold waiting to be captured (contract billing). */
export type ProviderPaymentStatus =
  | 'requires_action'
  | 'processing'
  | 'authorised'
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
  /** What a hold can still capture (0 unless `authorised`). */
  readonly capturableCents: number;
  /** What was actually taken (a partial capture takes less than the hold). */
  readonly receivedCents: number;
  /** The card network's deadline for capturing a hold, when known. */
  readonly captureBefore: Date | null;
  /** The charge that took the money (`ch_…`), once there is one: what a
   * helper transfer names as its `source_transaction`. */
  readonly chargeReference: string | null;
};

export type PaymentRefund = {
  readonly refundReference: string;
  readonly refundedAt: Date;
};

/** A partial refund's state at the provider (Tier 3 step 2). */
export type ProviderRefundStatus = 'pending' | 'succeeded' | 'failed' | 'canceled';

export type ProviderRefund = {
  readonly reference: string;
  readonly status: ProviderRefundStatus;
  readonly amountCents: number;
  /** The intent refunded. */
  readonly paymentReference: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly failureReason: string | null;
  readonly createdAt: Date;
};

export type CreateRefundInput = {
  /** The intent (one charge per cycle) to refund part of. */
  readonly paymentReference: string;
  readonly amountCents: number;
  /** Same key → the same refund, never a second one. */
  readonly idempotencyKey: string;
  /** `refund_id`, `session_id`, `cycle_id` (spec §7). */
  readonly metadata: Record<string, string>;
};

/** A transfer to a helper's connected account (Tier 3 step 2). */
export type ProviderTransfer = {
  readonly reference: string;
  readonly amountCents: number;
  readonly destination: string;
  readonly sourceTransaction: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly reversedCents: number;
  readonly createdAt: Date;
};

export type CreateTransferInput = {
  readonly amountCents: number;
  readonly currency: 'CAD';
  /** The helper's connected account (`acct_…`). */
  readonly destination: string;
  /** The cycle's charge (`ch_…`): the provider waits for its funds. */
  readonly sourceTransaction: string | null;
  readonly idempotencyKey: string;
  readonly metadata: Record<string, string>;
  readonly description?: string;
};

/** A refusal is DATA (the account can't receive it, the balance is short):
 * a business outcome for an admin. Only trouble reaching the provider
 * fails the effect. */
export type TransferResult =
  | { readonly status: 'created'; readonly transfer: ProviderTransfer }
  | { readonly status: 'refused'; readonly reason: string };

/** A connected account's bank payout, re-fetched. */
export type ProviderPayout = {
  readonly reference: string;
  readonly status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
  readonly amountCents: number;
  readonly arrivalDate: Date | null;
  readonly createdAt: Date;
  readonly failureReason: string | null;
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
  | 'createDashboardLink'
  | 'chargeSavedCard'
  | 'capturePayment'
  | 'findPaymentByRowId'
  | 'createRefund'
  | 'getRefund'
  | 'createTransfer'
  | 'getTransfer'
  | 'getPayout';

export class PaymentDeclinedError extends Data.TaggedError('PaymentDeclinedError')<{
  reason: string;
}> {}

export class PaymentProviderError extends Data.TaggedError('PaymentProviderError')<{
  operation: PaymentOperation;
  cause: unknown;
  /** Set when the provider refused the idempotency key itself: `mismatch`
   * — the key was already used with different parameters (it will never be
   * accepted again for this request); `in_flight` — the first request under
   * the key is still being processed. Neither says whether money moved. */
  idempotency?: 'mismatch' | 'in_flight';
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
  /** Shown on the provider's receipt (the itemised tax lines go here). */
  description?: string;
};

/** An off-session charge on a family's saved card (contract billing). */
export type ChargeSavedCardInput = {
  readonly amountCents: number;
  readonly currency: 'CAD';
  readonly customer: string;
  readonly card: string;
  /** `manual`: a hold, captured later. `automatic`: taken at once. */
  readonly capture: 'manual' | 'automatic';
  /** Same key must produce the same intent, never a second charge. */
  readonly idempotencyKey: string;
  readonly metadata: { payment_id: string } & Record<string, string>;
  readonly description?: string;
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
    /** Charges (or holds) a saved card with nobody present. A decline is
     * DATA — `status: 'failed'` with the card's reason — because it is a
     * business outcome (grace period, suspension), not a fault. Only trouble
     * reaching the provider fails the effect. The same key with the same
     * input, within 24 h, returns the first answer (a replay); the same key
     * with a different input fails with `idempotency: 'mismatch'`. */
    chargeSavedCard: (
      input: ChargeSavedCardInput
    ) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    /** Captures a hold; a partial capture releases the rest. */
    capturePayment: (input: {
      reference: string;
      amountCents: number;
      idempotencyKey: string;
    }) => Effect.Effect<ProviderPayment, PaymentProviderError>;
    /** The intent created for our `payments.id` (its `metadata.payment_id`),
     * or null when none is found. Search is eventually consistent, so a null
     * is NOT proof that nothing exists — only a replay of the create under
     * its key (within the provider's 24 h key window) is authoritative. */
    findPaymentByRowId: (
      paymentId: string
    ) => Effect.Effect<ProviderPayment | null, PaymentProviderError>;
    /** A partial refund of a captured intent (several may be made, up to
     * what it captured). A refund the provider accepted but will fail later
     * comes back `pending`, then `failed` on a re-fetch. */
    createRefund: (input: CreateRefundInput) => Effect.Effect<ProviderRefund, PaymentProviderError>;
    getRefund: (reference: string) => Effect.Effect<ProviderRefund, PaymentProviderError>;
    /** Sends money to a helper's connected account. */
    createTransfer: (
      input: CreateTransferInput
    ) => Effect.Effect<TransferResult, PaymentProviderError>;
    getTransfer: (reference: string) => Effect.Effect<ProviderTransfer, PaymentProviderError>;
    /** A connected account's payout (webhooks only say "it changed"). */
    getPayout: (input: {
      account: string;
      reference: string;
    }) => Effect.Effect<ProviderPayout, PaymentProviderError>;
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
    getPayoutAccount: (
      reference: string
    ) => Effect.Effect<PayoutAccountSnapshot, PaymentProviderError>;
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
  const taxLines = lineItems.length === 0 ? [] : policy.taxLines;
  // Integer cents throughout; the lines were rounded by the one rule.
  const taxCents = taxLines.reduce((total, line) => total + line.taxCents, 0);

  return {
    amountCents,
    lineItems,
    feeCents,
    taxCents,
    taxLines,
    totalCents: amountCents + feeCents + taxCents,
    currency: 'CAD'
  };
};

/** "Background check $55.00 · Admin fee $5.00 · HST (ON) 13% $7.80 (GST/HST
 * PLACEHOLDER-…)" — the receipt line the provider prints. */
export const describeQuote = (title: string, quote: Money): string => {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const byLabel = new Map<string, { cents: number; registration: string | null }>();
  for (const line of quote.taxLines) {
    const entry = byLabel.get(line.label) ?? { cents: 0, registration: line.registrationNumber };
    entry.cents += line.taxCents;
    byLabel.set(line.label, entry);
  }
  const parts = [
    `${title} ${dollars(quote.amountCents)}`,
    ...(quote.feeCents > 0 ? [`Admin fee ${dollars(quote.feeCents)}`] : []),
    ...[...byLabel].map(
      ([label, { cents, registration }]) =>
        // A line exists only while Poppynz is registered; a null number is a
        // registration whose number is not final yet (never a placeholder).
        `${label} ${dollars(cents)} (reg. ${registration ?? 'pending'})`
    )
  ];
  return parts.join(' · ').slice(0, 1000);
};
