import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Every message must exist in both locales: a key missing from fr.json would
// silently fall back to English (or fail to compile) in production.
const read = (locale: 'en' | 'fr') => {
	const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url));
	const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
	delete json.$schema;
	return json;
};

const en = read('en');
const fr = read('fr');

/** Placeholder names a message uses (all variants of a plural message). */
const placeholders = (value: unknown): Array<string> => {
	const text = JSON.stringify(value);
	return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!))].sort();
};

describe('message files', () => {
	it('fr.json has exactly the keys of en.json', () => {
		const missingInFr = Object.keys(en).filter((key) => !(key in fr));
		const extraInFr = Object.keys(fr).filter((key) => !(key in en));
		expect(missingInFr).toEqual([]);
		expect(extraInFr).toEqual([]);
	});

	it('has no empty translations', () => {
		// French puts the $ after the amount, so the rate input's prefix is empty.
		const intentionallyEmpty = new Set(['contracts_wizard_rate_prefix']);
		const empty = Object.entries(fr)
			.filter(([key]) => !intentionallyEmpty.has(key))
			.filter(([, value]) => typeof value === 'string' && value.trim() === '')
			.map(([key]) => key);
		expect(empty).toEqual([]);
	});

	it('uses the same placeholders in both locales', () => {
		const mismatched = Object.keys(en).filter(
			(key) => key in fr && placeholders(en[key]).join() !== placeholders(fr[key]).join()
		);
		expect(mismatched).toEqual([]);
	});

	it('mentions no Spanish anywhere (EN/FR only, UAT #3)', () => {
		expect(JSON.stringify(en)).not.toMatch(/español|spanish/i);
		expect(JSON.stringify(fr)).not.toMatch(/español|espagnol/i);
	});
});
