import { env } from '$env/dynamic/public';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Stripe.js, loaded from Stripe on first use and shared after that. Card data
 * goes from the Payment Element straight to Stripe — never through Poppynz.
 * Resolves to null when PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured.
 */
export function getStripe(): Promise<Stripe | null> {
	const key = env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
	if (!key) return Promise.resolve(null);
	stripePromise ??= loadStripe(key);
	return stripePromise;
}
