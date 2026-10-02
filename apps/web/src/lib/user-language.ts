import { getProfile } from '$lib/api/provider-profile';
import type { StripeElementLocale } from '@stripe/stripe-js';

let languagePromise: Promise<string | null> | null = null;

/**
 * The signed-in user's saved language (`profile.language`, e.g. 'en'/'es'),
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
 * Maps the profile's `language` to Stripe Elements' `locale` option. Only
 * 'en' and 'es' are supported today; anything else (including no profile
 * yet) falls back to 'auto', Stripe's own browser-based guess.
 */
export function toStripeLocale(language: string | null | undefined): StripeElementLocale {
	return language === 'en' || language === 'es' ? language : 'auto';
}
