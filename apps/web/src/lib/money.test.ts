import { describe, expect, it } from 'vitest';
import { centsToDollars, dollarsToCents } from './money';

describe('centsToDollars', () => {
	it('formats cents as a two-decimal dollar string', () => {
		expect(centsToDollars(1800)).toBe('18.00');
		expect(centsToDollars(2250)).toBe('22.50');
		expect(centsToDollars(5)).toBe('0.05');
	});
});

describe('dollarsToCents', () => {
	it('parses plain and decorated amounts', () => {
		expect(dollarsToCents('18')).toBe(1800);
		expect(dollarsToCents('18.5')).toBe(1850);
		expect(dollarsToCents('$19.00')).toBe(1900);
		expect(dollarsToCents(' 22.25 ')).toBe(2225);
	});

	it('rejects non-amounts and non-positive values', () => {
		expect(dollarsToCents('')).toBeNull();
		expect(dollarsToCents('abc')).toBeNull();
		expect(dollarsToCents('18.999')).toBeNull();
		expect(dollarsToCents('-5')).toBeNull();
		expect(dollarsToCents('0')).toBeNull();
	});
});
