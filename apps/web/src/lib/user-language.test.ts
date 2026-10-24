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
			.mockResolvedValueOnce({ ok: true, data: { language: 'fr' } });

		// A session that isn't ready yet (or a network blip) must not pin the
		// result forever: the caller falls back to Stripe's own locale guess,
		// and the next call gets a fresh read.
		await expect(getUserLanguage()).resolves.toBeNull();
		await expect(getUserLanguage()).resolves.toBe('fr');
		expect(getProfile).toHaveBeenCalledTimes(2);
	});

	it('reads the profile once and shares the language after that', async () => {
		await getUserLanguage();
		await getUserLanguage();
		expect(getProfile).not.toHaveBeenCalled();
	});
});

describe('toStripeLocale', () => {
	it('gives Stripe Canadian French for fr and English otherwise', () => {
		expect(toStripeLocale('fr')).toBe('fr-CA');
		expect(toStripeLocale('en')).toBe('en');
	});
});
