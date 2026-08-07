/**
 * Client session store. The better-auth cookie is the source of truth;
 * `fetchSession()` reads it via /api/auth/get-session and caches the result
 * in localStorage so `getSession()` stays synchronous for guards and UI.
 */
import { browser } from '$app/environment';
import type { Role } from './auth';

/** Roles a session can carry. Sign-up stays limited to `Role`; admins are
 * provisioned out-of-band (SQL promote in dev). */
export type SessionRole = Role | 'admin';

export interface MockSession {
	email: string;
	role: SessionRole;
	/** Admin user id driving this session, when it is an impersonation (12d). */
	impersonatedBy: string | null;
	/** ISO expiry of the better-auth session — the impersonation countdown. */
	sessionExpiresAt: string | null;
}

const SESSION_KEY = 'poppynz:session';

const isSessionRole = (value: unknown): value is SessionRole =>
	value === 'family' || value === 'service-provider' || value === 'admin';

/**
 * Ask the API who is signed in (better-auth cookie) and refresh the local
 * cache. Returns null — and clears the cache — when there is no session.
 */
export async function fetchSession(): Promise<MockSession | null> {
	if (!browser) return null;
	try {
		const res = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
		if (!res.ok) return getSession();
		const body = (await res.json()) as {
			user?: { email?: string; role?: string | null };
			session?: { impersonatedBy?: string | null; expiresAt?: string | null };
		} | null;
		const email = body?.user?.email;
		if (!email) {
			endSession();
			return null;
		}
		const session: MockSession = {
			email,
			role: isSessionRole(body?.user?.role) ? body.user.role : 'family',
			impersonatedBy: body?.session?.impersonatedBy ?? null,
			sessionExpiresAt: body?.session?.expiresAt ?? null
		};
		localStorage.setItem(SESSION_KEY, JSON.stringify(session));
		return session;
	} catch {
		// Network hiccup: keep whatever we knew last rather than logging out.
		return getSession();
	}
}

export function getSession(): MockSession | null {
	if (!browser) return null;
	const raw = localStorage.getItem(SESSION_KEY);
	if (!raw) return null;
	try {
		// Backfill fields older cached sessions predate.
		const parsed = JSON.parse(raw) as MockSession;
		parsed.impersonatedBy ??= null;
		parsed.sessionExpiresAt ??= null;
		return parsed;
	} catch {
		return null;
	}
}

export function endSession(): void {
	if (!browser) return;
	localStorage.removeItem(SESSION_KEY);
}
