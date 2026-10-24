/**
 * The active locale and its `Intl` tag (UAT #3). The app speaks English and
 * Canadian French; Paraglide resolves the locale from the PARAGLIDE_LOCALE
 * cookie, then Accept-Language, then English (paraglide.options.js,
 * hooks.server.ts). Switching lives in locale-sync.ts.
 */
import { getLocale, locales, toLocale, type Locale } from '$lib/paraglide/runtime';

export type { Locale };
export { getLocale, locales };

/** BCP 47 tag for `Intl` — both locales are Canadian (CAD, Quebec French). */
export function intlLocale(locale: Locale = getLocale()): 'en-CA' | 'fr-CA' {
	return locale === 'fr' ? 'fr-CA' : 'en-CA';
}

/** Maps any stored language to a supported locale; the retired 'es' and
 * anything unknown become English. */
export function toSupportedLocale(language: string | null | undefined): Locale {
	return toLocale(language) ?? 'en';
}

/** A number in the active locale ("1,234.5" / "1 234,5"). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(intlLocale(), options).format(value);
}
