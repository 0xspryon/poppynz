import { describe, expect, it } from 'vitest';
import { formatPlace, provinceCode, withProvince } from './location';

describe('provinceCode', () => {
	it('reads codes and full names, French included', () => {
		expect(provinceCode('MB')).toBe('MB');
		expect(provinceCode('mb')).toBe('MB');
		expect(provinceCode('Manitoba')).toBe('MB');
		expect(provinceCode('Québec')).toBe('QC');
		expect(provinceCode('Colombie-Britannique')).toBe('BC');
		expect(provinceCode('Île-du-Prince-Édouard')).toBe('PE');
	});

	it('keeps anything it does not know as it was', () => {
		expect(provinceCode('Bavaria')).toBe('Bavaria');
		expect(provinceCode('  ')).toBeNull();
		expect(provinceCode(null)).toBeNull();
	});
});

describe('formatPlace (UAT round 2 #2)', () => {
	it('puts the province next to the city', () => {
		expect(formatPlace('Winnipeg', 'MB')).toBe('Winnipeg, MB');
		expect(formatPlace('Winnipeg', 'Manitoba')).toBe('Winnipeg, MB');
	});

	it('never repeats the city or the province (UAT #7)', () => {
		expect(formatPlace('Winnipeg, MB', 'MB')).toBe('Winnipeg, MB');
		expect(formatPlace('Winnipeg, Manitoba', 'MB')).toBe('Winnipeg, Manitoba');
		expect(formatPlace('Québec', 'QC')).toBe('Québec, QC');
	});

	it('shows what it has', () => {
		expect(formatPlace('Winnipeg', null)).toBe('Winnipeg');
		expect(formatPlace(null, 'MB')).toBe('MB');
		expect(formatPlace(' ', '')).toBeNull();
	});
});

describe('withProvince', () => {
	it('leaves a saved address alone when it already names the province', () => {
		expect(withProvince('123 Main St, Winnipeg, MB R3C 1A1, Canada', 'MB')).toBe(
			'123 Main St, Winnipeg, MB R3C 1A1, Canada'
		);
		expect(withProvince('Winnipeg, Manitoba, Canada', 'MB')).toBe('Winnipeg, Manitoba, Canada');
	});

	it('adds the province to an address that lacks it', () => {
		expect(withProvince('Winnipeg', 'MB')).toBe('Winnipeg, MB');
	});
});
