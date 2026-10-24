// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' as 'en' | 'fr' }));
vi.mock('$lib/paraglide/runtime', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/paraglide/runtime')>()),
	getLocale: () => locale.current
}));

import { switchLocale, syncLocaleWithProfile } from './locale-sync';

const PENDING_KEY = 'poppynz:pending-locale';

afterEach(() => {
	locale.current = 'en';
	localStorage.clear();
});

const switchDeps = (signedIn: boolean) => ({
	isSignedIn: () => signedIn,
	saveLanguage: vi.fn(async () => undefined),
	applyLocale: vi.fn()
});

const syncDeps = (stored: string | null, own = true) => ({
	isOwnSession: () => own,
	readLanguage: vi.fn(async () => stored),
	saveLanguage: vi.fn(async () => undefined),
	applyLocale: vi.fn()
});

describe('switchLocale (the toggle)', () => {
	it('saves the choice to the profile when signed in, then switches', async () => {
		const deps = switchDeps(true);
		await switchLocale('fr', deps);
		expect(deps.saveLanguage).toHaveBeenCalledWith('fr');
		expect(deps.applyLocale).toHaveBeenCalledWith('fr');
		expect(localStorage.getItem(PENDING_KEY)).toBeNull();
	});

	it('still switches when saving the profile fails', async () => {
		const deps = switchDeps(true);
		deps.saveLanguage.mockRejectedValueOnce(new Error('offline'));
		await switchLocale('fr', deps);
		expect(deps.applyLocale).toHaveBeenCalledWith('fr');
	});

	it('remembers a signed-out choice for the next sign-in', async () => {
		const deps = switchDeps(false);
		await switchLocale('fr', deps);
		expect(deps.saveLanguage).not.toHaveBeenCalled();
		expect(deps.applyLocale).toHaveBeenCalledWith('fr');
		expect(localStorage.getItem(PENDING_KEY)).toBe('fr');
	});

	it('does nothing when the locale is already active', async () => {
		locale.current = 'fr';
		const deps = switchDeps(true);
		await switchLocale('fr', deps);
		expect(deps.saveLanguage).not.toHaveBeenCalled();
		expect(deps.applyLocale).not.toHaveBeenCalled();
	});
});

describe('syncLocaleWithProfile (signed-in layouts)', () => {
	it("adopts the profile's language when it differs from the page", async () => {
		const deps = syncDeps('fr');
		await syncLocaleWithProfile(deps);
		expect(deps.applyLocale).toHaveBeenCalledWith('fr');
		expect(deps.saveLanguage).not.toHaveBeenCalled();
	});

	it('leaves the page alone when the profile already matches', async () => {
		const deps = syncDeps('en');
		await syncLocaleWithProfile(deps);
		expect(deps.applyLocale).not.toHaveBeenCalled();
	});

	it('treats a legacy es preference as English', async () => {
		const deps = syncDeps('es');
		await syncLocaleWithProfile(deps);
		expect(deps.applyLocale).not.toHaveBeenCalled();
	});

	it('saves a choice made while signed out instead of overriding it', async () => {
		locale.current = 'fr';
		localStorage.setItem(PENDING_KEY, 'fr');
		const deps = syncDeps('en');
		await syncLocaleWithProfile(deps);
		expect(deps.saveLanguage).toHaveBeenCalledWith('fr');
		expect(deps.applyLocale).not.toHaveBeenCalled();
		expect(localStorage.getItem(PENDING_KEY)).toBeNull();
	});

	it('never touches an impersonated user’s preference', async () => {
		const deps = syncDeps('fr', false);
		await syncLocaleWithProfile(deps);
		expect(deps.readLanguage).not.toHaveBeenCalled();
		expect(deps.applyLocale).not.toHaveBeenCalled();
	});

	it('does nothing when the profile cannot be read', async () => {
		const deps = syncDeps(null);
		await syncLocaleWithProfile(deps);
		expect(deps.applyLocale).not.toHaveBeenCalled();
		expect(deps.saveLanguage).not.toHaveBeenCalled();
	});
});
