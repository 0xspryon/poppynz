/** Integer cents → display string, e.g. 1800 → "18.00" (no currency symbol). */
export function centsToDollars(cents: number): string {
	return (cents / 100).toFixed(2);
}

/** Integer cents → compact display, e.g. 2800 → "$28", 2850 → "$28.50". */
export function centsToCompactDollars(cents: number): string {
	const dollars = cents / 100;
	return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * Rate summary across a provider's services: "$21/hr" when min = max,
 * otherwise "$25–$40/hr".
 */
export function rateRangeLabel(minCents: number, maxCents: number): string {
	if (minCents === maxCents) return `${centsToCompactDollars(minCents)}/hr`;
	return `${centsToCompactDollars(minCents)}–${centsToCompactDollars(maxCents)}/hr`;
}

/**
 * Parse a user-entered dollar amount ("18", "18.5", "$18.00") into integer
 * cents. Returns null for anything that isn't a positive amount.
 */
export function dollarsToCents(input: string): number | null {
	const cleaned = input.trim().replace(/^\$/, '');
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
	const cents = Math.round(Number.parseFloat(cleaned) * 100);
	return cents > 0 ? cents : null;
}
