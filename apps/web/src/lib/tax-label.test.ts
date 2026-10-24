import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' as 'en' | 'fr' }));
vi.mock('$lib/paraglide/runtime', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/paraglide/runtime')>()),
	getLocale: () => locale.current
}));

import { localizeTaxLabel } from './tax-label';

afterEach(() => {
	locale.current = 'en';
});

describe('localizeTaxLabel', () => {
	it('keeps the server label in English', () => {
		expect(localizeTaxLabel('HST (ON) 13%')).toBe('HST (ON) 13%');
		expect(localizeTaxLabel('QST (QC) 9.975%')).toBe('QST (QC) 9.975%');
	});

	it('uses the French abbreviations and number format in French', () => {
		locale.current = 'fr';
		expect(localizeTaxLabel('GST (QC) 5%')).toBe('TPS (QC) 5 %');
		expect(localizeTaxLabel('QST (QC) 9.975%')).toBe('TVQ (QC) 9,975 %');
		expect(localizeTaxLabel('HST (NS) 14%')).toBe('TVH (NS) 14 %');
	});

	it('leaves labels it does not recognise untouched', () => {
		locale.current = 'fr';
		expect(localizeTaxLabel('Eco fee')).toBe('Eco fee');
	});
});
