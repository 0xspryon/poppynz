import { describe, expect, it } from 'vitest';
import { landingPathFor } from './role-landing';

describe('landingPathFor (U1)', () => {
	it('lands every role in its own area', () => {
		expect(landingPathFor('admin')).toBe('/admin');
		expect(landingPathFor('accountant')).toBe('/accountant');
		expect(landingPathFor('service-provider')).toBe('/service-provider/dashboard');
		expect(landingPathFor('family')).toBe('/family/profile');
	});

	it('has no landing without a session', () => {
		expect(landingPathFor(null)).toBeNull();
		expect(landingPathFor(undefined)).toBeNull();
	});
});
