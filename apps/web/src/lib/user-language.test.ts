import { afterEach, describe, expect, it, vi } from 'vitest';

const { getProfile } = vi.hoisted(() => ({ getProfile: vi.fn() }));

vi.mock('$lib/api/provider-profile', () => ({ getProfile }));

import { getUserLanguage, toStripeLocale } from './user-language';

describe('getUserLanguage', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('resolves to null when the profile cannot be read, and tries again next time', async () => {
		getProfile
			.mockResolvedValueOnce({
				ok: false,
				error: { code: 'UNAUTHORIZED', message: 'nope', status: 401 }
			})
			.mockResolvedValueOnce({ ok: true, data: { language: 'es' } });

		// A session that isn't ready yet (or a network blip) must not pin the
		// result forever: the caller falls back to Stripe's own locale guess,
		// and the next call gets a fresh read.
		await expect(getUserLanguage()).resolves.toBeNull();
		await expect(getUserLanguage()).resolves.toBe('es');
		expect(getProfile).toHaveBeenCalledTimes(2);
	});

	it('reads the profile once and shares the language after that', async () => {
		await getUserLanguage();
		await getUserLanguage();
		expect(getProfile).not.toHaveBeenCalled();
	});
});

describe('toStripeLocale', () => {
	it('passes en and es through, and falls back to auto otherwise', () => {
		expect(toStripeLocale('en')).toBe('en');
		expect(toStripeLocale('es')).toBe('es');
		expect(toStripeLocale('fr')).toBe('auto');
		expect(toStripeLocale(null)).toBe('auto');
		expect(toStripeLocale(undefined)).toBe('auto');
	});
});
