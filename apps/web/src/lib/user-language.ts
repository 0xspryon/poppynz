import { getProfile } from '$lib/api/provider-profile';
import type { StripeElementLocale } from '@stripe/stripe-js';
import type { Locale } from '$lib/paraglide/runtime';

let languagePromise: Promise<string | null> | null = null;

/**
 * The signed-in user's saved language (`profile.language`, 'en'/'fr'),
 * read once per session and shared after that. A failed read (no session
 * yet, a network blip) resolves to null and is forgotten so the next call
 * tries again — callers fall back to Stripe's own locale detection.
 */
export function getUserLanguage(): Promise<string | null> {
	languagePromise ??= getProfile().then(
		(result) => {
			if (result.ok) return result.data.language;
			languagePromise = null;
			return null;
		},
		() => {
			languagePromise = null;
			return null;
		}
	);
	return languagePromise;
}

/**
 * Maps the active locale to Stripe Elements' `locale` option, so the card
 * form speaks the same language as the page (Canadian French for 'fr').
 */
export function toStripeLocale(locale: Locale): StripeElementLocale {
	return locale === 'fr' ? 'fr-CA' : 'en';
}
