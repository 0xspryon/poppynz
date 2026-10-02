import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadStripe } = vi.hoisted(() => ({ loadStripe: vi.fn() }));

vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_x' } }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe }));

import { getStripe } from './stripe';

describe('getStripe', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('resolves to null when Stripe.js fails to load, and tries again next time', async () => {
		const stripe = { elements: vi.fn() };
		loadStripe
			.mockRejectedValueOnce(new Error('Failed to load Stripe.js'))
			.mockResolvedValueOnce(stripe);

		// A network failure or an ad blocker must not leave callers waiting on
		// a rejected promise forever: they show "not available" instead.
		await expect(getStripe()).resolves.toBeNull();
		await expect(getStripe()).resolves.toBe(stripe);
		expect(loadStripe).toHaveBeenCalledTimes(2);
	});

	it('loads Stripe.js once and shares it after that', async () => {
		await getStripe();
		await getStripe();
		expect(loadStripe).not.toHaveBeenCalled();
	});
});
