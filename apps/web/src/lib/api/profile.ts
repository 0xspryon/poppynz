/**
 * Mock session store — UI-only stand-in for the real session endpoints.
 * State lives in localStorage so the session survives reloads; swap the
 * internals for real API calls without changing the function signatures.
 */
import { browser } from '$app/environment';
import type { Role } from './auth';

export interface MockSession {
	email: string;
	role: Role;
}

const SESSION_KEY = 'poppynz:session';

export function getSession(): MockSession | null {
	if (!browser) return null;
	const raw = localStorage.getItem(SESSION_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as MockSession;
	} catch {
		return null;
	}
}

export function startSession(session: MockSession): void {
	if (!browser) return;
	localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function endSession(): void {
	if (!browser) return;
	localStorage.removeItem(SESSION_KEY);
}
