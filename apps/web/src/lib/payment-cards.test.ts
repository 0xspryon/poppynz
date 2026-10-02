import { describe, expect, it } from 'vitest';
import { cardBrandName, cardExpiry, cardLabel } from './payment-cards';

describe('payment card labels', () => {
	it('names known brands and capitalises unknown ones', () => {
		expect(cardBrandName('visa')).toBe('Visa');
		expect(cardBrandName('amex')).toBe('American Express');
		expect(cardBrandName('link')).toBe('Link');
	});

	it('shows only the last four digits', () => {
		expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242');
	});

	it('pads the expiry month', () => {
		expect(cardExpiry({ expMonth: 3, expYear: 2031 })).toBe('03/2031');
	});
});
