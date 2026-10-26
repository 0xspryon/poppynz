import { describe, expect, it } from 'vitest';
import { contractLandingPath, landingPathFor } from './role-landing';

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

describe('contractLandingPath (UAT round 2 #5)', () => {
	it('opens the one running contract', () => {
		expect(contractLandingPath('family', ['c-1'])).toBe('/family/contracts/c-1');
		expect(contractLandingPath('service-provider', ['c-1'])).toBe(
			'/service-provider/contracts/c-1'
		);
	});

	it('opens the contracts list filtered to active with several', () => {
		expect(contractLandingPath('family', ['c-1', 'c-2'])).toBe('/family/contracts?filter=active');
		expect(contractLandingPath('service-provider', ['c-1', 'c-2'])).toBe(
			'/service-provider/contracts?filter=active'
		);
	});

	it('keeps the usual landing without a running contract, and for admin and accountant', () => {
		expect(contractLandingPath('family', [])).toBeNull();
		expect(contractLandingPath('admin', ['c-1'])).toBeNull();
		expect(contractLandingPath('accountant', ['c-1'])).toBeNull();
		expect(contractLandingPath(null, ['c-1'])).toBeNull();
	});
});
