import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	formatTaxRate,
	parseRatePercent,
	taxComponentLabel,
	taxComponentList,
	taxWriteErrorText
} from './tax';

describe('tax labels', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it('shows components as GST/HST in English and TPS/TVH/TVQ in French', () => {
		overwriteGetLocale(() => 'en');
		expect(taxComponentList(['gst', 'hst'])).toBe('GST, HST');
		overwriteGetLocale(() => 'fr');
		expect(taxComponentList(['gst', 'hst', 'qst', 'pst'])).toBe('TPS, TVH, TVQ, TVP');
		expect(taxComponentLabel('xyz')).toBe('XYZ');
	});

	it('formats rates as locale percentages', () => {
		overwriteGetLocale(() => 'en');
		expect(formatTaxRate(13000)).toBe('13%');
		expect(formatTaxRate(9975)).toBe('9.975%');
		overwriteGetLocale(() => 'fr');
		expect(formatTaxRate(13000).replace(/\s/g, ' ')).toBe('13 %');
		expect(formatTaxRate(9975).replace(/\s/g, ' ')).toBe('9,975 %');
	});

	it('parses a rate typed with a dot or a French comma', () => {
		expect(parseRatePercent('13.5')).toBe(13500);
		expect(parseRatePercent('9,975')).toBe(9975);
		expect(parseRatePercent('101')).toBeNull();
		expect(parseRatePercent('abc')).toBeNull();
	});

	it('maps refusal codes to localized sentences, never the raw server message', () => {
		overwriteGetLocale(() => 'en');
		expect(taxWriteErrorText({ code: 'FORBIDDEN', message: 'x' })).toBe(
			'Your account may view the tax configuration but not change it.'
		);
		expect(taxWriteErrorText({ code: 'SOMETHING_NEW', message: 'raw' })).toBe(
			'Something went wrong on our side. Please try again.'
		);
		overwriteGetLocale(() => 'fr');
		expect(taxWriteErrorText({ code: 'TAX_EFFECTIVE_RANGE_INVALID', message: 'x' })).toBe(
			'La date de fin doit être postérieure à la date de début.'
		);
	});
});
