/** Display helpers for a saved card (brand + last four digits only). */

const BRAND_NAMES: Record<string, string> = {
	amex: 'American Express',
	diners: 'Diners Club',
	discover: 'Discover',
	jcb: 'JCB',
	mastercard: 'Mastercard',
	unionpay: 'UnionPay',
	visa: 'Visa'
};

/** Stripe's brand code → the name people know, e.g. "visa" → "Visa". */
export function cardBrandName(brand: string): string {
	return BRAND_NAMES[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** "Visa •••• 4242". */
export function cardLabel(card: { brand: string; last4: string }): string {
	return `${cardBrandName(card.brand)} •••• ${card.last4}`;
}

/** "12/2034". */
export function cardExpiry(card: { expMonth: number; expYear: number }): string {
	return `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`;
}
