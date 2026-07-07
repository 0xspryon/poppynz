import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyMagicLink } from './auth';

describe('verifyMagicLink', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('reports expired tokens and points at the recovery screen', async () => {
		const result = verifyMagicLink('expired');
		await vi.runAllTimersAsync();
		await expect(result).resolves.toEqual({ status: 'expired', destination: '/auth/expired' });
	});

	it('sends verified users without a pending sign-in to onboarding', async () => {
		const result = verifyMagicLink('demo');
		await vi.runAllTimersAsync();
		await expect(result).resolves.toEqual({ status: 'ok', destination: '/onboarding' });
	});
});
