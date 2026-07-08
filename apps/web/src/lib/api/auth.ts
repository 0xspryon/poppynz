/**
 * Mock auth API — UI-only stand-in for the real magic-link endpoints.
 * Simulates latency and keeps the "pending sign-in" state in sessionStorage
 * so the flow survives page navigation. Swap the internals for real API
 * calls without changing the function signatures.
 */
import { browser } from '$app/environment';

export type Role = 'family' | 'service-provider';
export type AuthIntent = 'sign-up' | 'sign-in';

export interface PendingAuth {
	email: string;
	role: Role | null;
	intent: AuthIntent;
	sentAt: number;
}

export type AuthDestination = '/' | '/auth/expired';

export interface VerifyResult {
	status: 'ok' | 'expired';
	/** Where the app should land after a successful verification. */
	destination: AuthDestination;
}

const STORAGE_KEY = 'poppynz:pending-auth';
const NETWORK_DELAY_MS = 700;
const VERIFY_DELAY_MS = 1600;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function getPendingAuth(): PendingAuth | null {
	if (!browser) return null;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PendingAuth;
	} catch {
		return null;
	}
}

function savePendingAuth(pending: PendingAuth): void {
	if (!browser) return;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
}

export function clearPendingAuth(): void {
	if (!browser) return;
	sessionStorage.removeItem(STORAGE_KEY);
}

export async function requestMagicLink(input: {
	email: string;
	role?: Role | null;
	intent: AuthIntent;
}): Promise<PendingAuth> {
	await delay(NETWORK_DELAY_MS);
	const pending: PendingAuth = {
		email: input.email,
		role: input.role ?? null,
		intent: input.intent,
		sentAt: Date.now()
	};
	savePendingAuth(pending);
	return pending;
}

export async function resendMagicLink(): Promise<PendingAuth | null> {
	const pending = getPendingAuth();
	if (!pending) return null;
	await delay(NETWORK_DELAY_MS);
	const refreshed: PendingAuth = { ...pending, sentAt: Date.now() };
	savePendingAuth(refreshed);
	return refreshed;
}

/**
 * Mock verification: the token "expired" simulates a stale link; anything
 * else verifies and starts a mock session. Successful verifications land on
 * the app entry until post-auth destinations exist again.
 */
export async function verifyMagicLink(token: string): Promise<VerifyResult> {
	await delay(VERIFY_DELAY_MS);
	if (token === 'expired') {
		return { status: 'expired', destination: '/auth/expired' };
	}
	const pending = getPendingAuth();
	if (browser && pending) {
		const { getSession, startSession } = await import('./profile');
		startSession({
			email: pending.email,
			// Sign-ins don't carry a role; keep the one from the previous session.
			role: pending.role ?? getSession()?.role ?? 'family'
		});
	}
	const destination = '/';
	clearPendingAuth();
	return { status: 'ok', destination };
}

export async function signOut(): Promise<void> {
	if (!browser) return;
	const { endSession } = await import('./profile');
	endSession();
}
