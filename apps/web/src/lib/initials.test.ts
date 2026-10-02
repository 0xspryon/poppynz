import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
	it('takes the first letter of the first and last words', () => {
		expect(initialsOf('Cleo Third')).toBe('CT');
		expect(initialsOf('Abby Applicant')).toBe('AA');
		expect(initialsOf('Mary Ann de Souza')).toBe('MS');
	});

	it('uses the single letter of a one-word name', () => {
		expect(initialsOf('Cleo')).toBe('C');
	});

	it('uppercases and ignores extra whitespace', () => {
		expect(initialsOf('  cleo   third ')).toBe('CT');
	});

	it('returns an empty string for a blank name', () => {
		expect(initialsOf('')).toBe('');
		expect(initialsOf('   ')).toBe('');
	});
});
