import { Effect, type Context } from 'effect';
import type Stripe from 'stripe';
import { PaymentProviderError, type Payments, type PayoutAccountSnapshot } from './port';

/**
 * Stripe Connect (Express) for helper payout accounts — piece 2b.
 *
 * Only the four calls 2b needs, typed structurally (like 2a's `StripeApi`) so
 * tests pass a fake and the real `Stripe` client satisfies it as is.
 */
export type StripeConnectClient = {
  accounts: Pick<Stripe['accounts'], 'create' | 'retrieve' | 'createLoginLink'>;
  accountLinks: Pick<Stripe['accountLinks'], 'create'>;
};

type ConnectOperations = Pick<
  Context.Tag.Service<Payments>,
  'createPayoutAccount' | 'createOnboardingLink' | 'getPayoutAccount' | 'createDashboardLink'
>;

/** Payment-ready needs all three flags; the requirement lists only explain
 * what is missing. `past_due` is a subset of what blocks payouts now, so the
 * two lists are merged. */
export const toPayoutAccountSnapshot = (account: Stripe.Account): PayoutAccountSnapshot => {
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? [])
  ];
  return {
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    transfersActive: account.capabilities?.transfers === 'active',
    requirementsDue: [...new Set(due)],
    disabledReason: account.requirements?.disabled_reason ?? null
  };
};

export const makeStripeConnectOperations = (stripe: StripeConnectClient): ConnectOperations => ({
  createPayoutAccount: ({ userId, email }) =>
    Effect.tryPromise({
      try: () =>
        stripe.accounts.create(
          {
            type: 'express',
            country: 'CA',
            business_type: 'individual',
            email,
            capabilities: { transfers: { requested: true } },
            metadata: { user_id: userId }
          },
          // A retried request returns the same account instead of a second one.
          { idempotencyKey: `payout-account:${userId}` }
        ),
      catch: (cause) => new PaymentProviderError({ operation: 'createPayoutAccount', cause })
    }).pipe(Effect.map((account) => ({ reference: account.id }))),

  createOnboardingLink: ({ reference, returnUrl, refreshUrl }) =>
    Effect.tryPromise({
      try: () =>
        stripe.accountLinks.create({
          account: reference,
          type: 'account_onboarding',
          return_url: returnUrl,
          refresh_url: refreshUrl
        }),
      catch: (cause) => new PaymentProviderError({ operation: 'createOnboardingLink', cause })
    }).pipe(Effect.map((link) => ({ url: link.url, expiresAt: new Date(link.expires_at * 1000) }))),

  getPayoutAccount: (reference) =>
    Effect.tryPromise({
      try: () => stripe.accounts.retrieve(reference),
      catch: (cause) => new PaymentProviderError({ operation: 'getPayoutAccount', cause })
    }).pipe(Effect.map(toPayoutAccountSnapshot)),

  createDashboardLink: (reference) =>
    Effect.tryPromise({
      try: () => stripe.accounts.createLoginLink(reference),
      catch: (cause) => new PaymentProviderError({ operation: 'createDashboardLink', cause })
    }).pipe(Effect.map((link) => ({ url: link.url })))
});
