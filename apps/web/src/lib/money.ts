/** Integer cents → display string, e.g. 1800 → "18.00" (no currency symbol). */
export function centsToDollars(cents: number): string {
	return (cents / 100).toFixed(2);
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
