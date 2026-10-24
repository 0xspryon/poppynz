import { getLocale, intlLocale, type Locale } from '$lib/locale';
import { m } from '$lib/paraglide/messages';

/** Integer cents → display string, e.g. 1800 → "18.00" (no currency symbol). */
export function centsToDollars(cents: number): string {
	return (cents / 100).toFixed(2);
}

/**
 * Integer cents → CAD in the active locale: 12500 → "$125.00" (en-CA) or
 * "125,00 $" (fr-CA). Money is always Canadian dollars.
 */
export function formatMoney(cents: number, locale: Locale = getLocale()): string {
	return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'CAD' }).format(
		cents / 100
	);
}

/** Integer cents → compact CAD, e.g. 2800 → "$28" / "28 $", 2850 → "$28.50" / "28,50 $". */
export function centsToCompactDollars(cents: number, locale: Locale = getLocale()): string {
	const whole = cents % 100 === 0;
	return new Intl.NumberFormat(intlLocale(locale), {
		style: 'currency',
		currency: 'CAD',
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2
	}).format(cents / 100);
}

/**
 * Rate summary across a provider's services: "$21/hr" when min = max,
 * otherwise "$25–$40/hr" ("21 $/h", "25 $ à 40 $/h" in French).
 */
export function rateRangeLabel(minCents: number, maxCents: number): string {
	if (minCents === maxCents) return m.money_per_hour({ amount: centsToCompactDollars(minCents) });
	return m.money_per_hour({
		amount: m.money_range({
			min: centsToCompactDollars(minCents),
			max: centsToCompactDollars(maxCents)
		})
	});
}

/**
 * Parse a user-entered dollar amount ("18", "18.5", "$18.00", or the French
 * "18,50 $") into integer cents. Returns null for anything that isn't a
 * positive amount.
 */
export function dollarsToCents(input: string): number | null {
	const cleaned = input
		.trim()
		.replace(/^\$\s*/, '')
		.replace(/\s*\$$/, '')
		.replace(',', '.');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	const cents = Math.round(Number.parseFloat(cleaned) * 100);
	return cents > 0 ? cents : null;
}
