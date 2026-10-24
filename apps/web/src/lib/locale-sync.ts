/**
 * Switching locale and keeping it in step with the profile (UAT #3).
 *
 * A signed-in user's choice is also saved on their profile (`language`) so
 * other devices and transactional emails follow it:
 * - the toggle saves it right away when someone is signed in;
 * - a choice made while signed out (the auth pages) is remembered and saved
 *   to the profile on the next signed-in page;
 * - otherwise, a signed-in page adopts the profile's language.
 */
import { updateProfile } from '$lib/api/provider-profile';
import { getUserLanguage } from '$lib/user-language';
import { getSession } from '$lib/api/profile';
import { toSupportedLocale } from '$lib/locale';
import { getLocale, setLocale, toLocale, type Locale } from '$lib/paraglide/runtime';

const PENDING_KEY = 'poppynz:pending-locale';

function readPending(): Locale | null {
	try {
		return toLocale(localStorage.getItem(PENDING_KEY)) ?? null;
	} catch {
		return null;
	}
}

function writePending(locale: Locale | null): void {
	try {
		if (locale) localStorage.setItem(PENDING_KEY, locale);
		else localStorage.removeItem(PENDING_KEY);
	} catch {
		// Storage blocked: the cookie still carries the choice on this device.
	}
}

export interface SwitchLocaleDeps {
	isSignedIn: () => boolean;
	saveLanguage: (locale: Locale) => Promise<unknown>;
	applyLocale: (locale: Locale) => void | Promise<void>;
}

// An admin impersonating someone must not rewrite that person's preference.
const ownSession = () => {
	const session = getSession();
	return session !== null && session.impersonatedBy === null;
};

const defaultDeps: SwitchLocaleDeps = {
	isSignedIn: ownSession,
	saveLanguage: (locale) => updateProfile({ language: locale }),
	applyLocale: (locale) => setLocale(locale)
};

/**
 * The toggle's action: save the choice (profile when signed in, otherwise
 * remembered for the next sign-in), then let Paraglide write the cookie and
 * reload the page in the new locale. The session cookie is untouched, so
 * nobody is signed out.
 */
export async function switchLocale(
	locale: Locale,
	deps: SwitchLocaleDeps = defaultDeps
): Promise<void> {
	if (locale === getLocale()) return;
	if (deps.isSignedIn()) {
		writePending(null);
		// Best effort: a failed save must not block the switch itself.
		await deps.saveLanguage(locale).catch(() => undefined);
	} else {
		writePending(locale);
	}
	await deps.applyLocale(locale);
}

export interface SyncLocaleDeps {
	isOwnSession: () => boolean;
	readLanguage: () => Promise<string | null>;
	saveLanguage: (locale: Locale) => Promise<unknown>;
	applyLocale: (locale: Locale) => void | Promise<void>;
}

const defaultSyncDeps: SyncLocaleDeps = {
	isOwnSession: ownSession,
	readLanguage: () => getUserLanguage(),
	saveLanguage: (locale) => updateProfile({ language: locale }),
	applyLocale: (locale) => setLocale(locale)
};

/**
 * Called once a signed-in layout knows who is there: keeps the profile's
 * language and the cookie in step (see the module comment for the rules).
 */
export async function syncLocaleWithProfile(deps: SyncLocaleDeps = defaultSyncDeps): Promise<void> {
	if (!deps.isOwnSession()) return;
	const pending = readPending();
	const stored = await deps.readLanguage().catch(() => null);
	if (stored === null) return;
	if (pending) {
		writePending(null);
		if (pending !== stored) await deps.saveLanguage(pending).catch(() => undefined);
		return;
	}
	const preferred = toSupportedLocale(stored);
	if (preferred !== getLocale()) await deps.applyLocale(preferred);
}
