import { env } from '$env/dynamic/public';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Stripe.js, loaded from Stripe on first use and shared after that. Card data
 * goes from the Payment Element straight to Stripe — never through Poppynz.
 * Resolves to null when PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured, or
 * when Stripe.js could not be loaded.
 */
export function getStripe(): Promise<Stripe | null> {
	const key = env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
	if (!key) return Promise.resolve(null);
	// A failed load (network, an ad blocker) resolves to null so callers show
	// "not available" rather than wait forever, and is forgotten so the next
	// call tries again.
	stripePromise ??= loadStripe(key).catch(() => {
		stripePromise = null;
		return null;
	});
	return stripePromise;
}
