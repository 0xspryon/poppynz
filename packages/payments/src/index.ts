import { Context, Data, Effect, Layer } from 'effect';

/**
 * The seam Stripe plugs into.
 *
 * Stripe lands in its own PR. Nothing outside this package may reference it —
 * that rule is what makes the next round additive rather than a rewrite, and
 * it's why the persisted columns are `provider` + `provider_reference` rather
 * than `stripe_*`.
 *
 * Three properties matter more than the provider:
 *
 *   - A quote is ITEMISED and frozen. The caller stores the breakdown in cents
 *     at authorisation time and never recomputes it for display, so a later
 *     fee or tax change can't retroactively alter what somebody was charged.
 *   - Authorisation is IDEMPOTENT on a caller-supplied key, so a retried order
 *     can't double-charge.
 *   - Refund exists from day one. The order-retry-exhausted path calls it, and
 *     that path is tested now rather than after real money is involved.
 *
 * The port knows nothing about what is being paid for. Fee and tax policy is
 * handed in by the caller per purpose — Credibled orders carry a flat
 * administration fee, bookings will carry something else — so a second
 * purpose never has to monkey-patch a config named after the first.
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

export type PaymentAuthorisation = {
  /** Opaque to everything above this port. A Stripe PaymentIntent id later, a
   * synthetic id today. */
  readonly reference: string;
  readonly authorisedAt: Date;
};

export type PaymentRefund = {
  readonly refundReference: string;
  readonly refundedAt: Date;
};

export class PaymentDeclinedError extends Data.TaggedError('PaymentDeclinedError')<{
  reason: string;
}> {}

export class PaymentProviderError extends Data.TaggedError('PaymentProviderError')<{
  operation: 'authorise' | 'refund';
  cause: unknown;
}> {}

export class Payments extends Context.Tag('@repo/payments/Payments')<
  Payments,
  {
    readonly provider: PaymentProvider;
    /** Itemises what somebody will pay before anything is charged. The caller
     * supplies the lines and the policy; the port adds the fee and the tax. */
    quote: (lineItems: ReadonlyArray<QuoteLineItem>, policy: QuotePolicy) => Effect.Effect<Money>;
    authorise: (input: {
      userId: string;
      quote: Money;
      /** Same key must produce the same authorisation, never a second charge. */
      idempotencyKey: string;
    }) => Effect.Effect<PaymentAuthorisation, PaymentDeclinedError | PaymentProviderError>;
    refund: (input: {
      reference: string;
      reason: string;
      /** Same key must resolve to the same refund, never a second one — a
       * lost write after a successful refund is retried, not repeated. */
      idempotencyKey: string;
    }) => Effect.Effect<PaymentRefund, PaymentProviderError>;
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

/**
 * Mock provider.
 *
 * Authorises instantly and records a synthetic reference. `failAuthorise` and
 * `failRefund` exist so the refund and retry-exhausted paths can be exercised
 * before a real provider is wired — those are exactly the paths that are
 * painful to test once money is real.
 */
export const makeMockPayments = (
  options: {
    failAuthorise?: boolean;
    failRefund?: boolean;
    now?: () => Date;
  } = {}
): Context.Tag.Service<Payments> => {
  const now = options.now ?? (() => new Date());
  const authorisations = new Map<string, PaymentAuthorisation>();
  const refunds = new Map<string, PaymentRefund>();

  return {
    provider: 'mock',

    quote: (lineItems, policy) => Effect.succeed(quoteFromPolicy(lineItems, policy)),

    authorise: ({ idempotencyKey }) =>
      Effect.gen(function* () {
        if (options.failAuthorise) {
          return yield* Effect.fail(new PaymentDeclinedError({ reason: 'mock decline' }));
        }

        // Idempotency is part of the contract, not an implementation detail —
        // the mock has to honour it or the retry path tests nothing.
        const existing = authorisations.get(idempotencyKey);
        if (existing) {
          return existing;
        }

        const authorisation: PaymentAuthorisation = {
          reference: `mock_auth_${idempotencyKey}`,
          authorisedAt: now()
        };
        authorisations.set(idempotencyKey, authorisation);
        return authorisation;
      }),

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
      })
  };
};

export const PaymentsMock = Layer.sync(Payments, () => makeMockPayments());

export const makePaymentsTest = (implementation: Partial<Context.Tag.Service<Payments>>) =>
  Layer.succeed(Payments, { ...makeMockPayments(), ...implementation });
