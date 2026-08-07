import { browser } from '$app/environment';
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

export type Role = 'family' | 'service-provider';
export type AuthIntent = 'sign-up' | 'sign-in';

export interface PendingAuth {
	email: string;
	role: Role | null;
	intent: AuthIntent;
	sentAt: number;
}

export type AuthDestination =
	| '/'
	| '/admin'
	| '/auth/expired'
	| '/service-provider/dashboard'
	| '/family/profile';

export interface VerifyResult {
	status: 'ok' | 'expired';
	/** Where the app should land after a successful verification. */
	destination: AuthDestination;
}

const signUpEndpoint = apiClient.auth['sign-up'].$post;
const signInEndpoint = apiClient.auth['sign-in'].$post;

export type SignUpLinkError = ErrorsOf<typeof signUpEndpoint>;
export type SignInLinkError = ErrorsOf<typeof signInEndpoint>;
export type ResendLinkError = SignUpLinkError | SignInLinkError;

const STORAGE_KEY = 'poppynz:pending-auth';

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

function savePendingAuth(partial: Omit<PendingAuth, 'sentAt'>): PendingAuth {
	const pending: PendingAuth = { ...partial, sentAt: Date.now() };
	if (browser) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
	return pending;
}

export function clearPendingAuth(): void {
	if (!browser) return;
	sessionStorage.removeItem(STORAGE_KEY);
}

export async function requestSignUpLink(input: {
	email: string;
	role: Role;
}): Promise<ApiResult<PendingAuth, SignUpLinkError>> {
	const result = await call(signUpEndpoint({ json: input }));
	if (!result.ok) return result;
	return {
		ok: true,
		data: savePendingAuth({ email: input.email, role: input.role, intent: 'sign-up' })
	};
}

export async function requestSignInLink(input: {
	email: string;
}): Promise<ApiResult<PendingAuth, SignInLinkError>> {
	const result = await call(signInEndpoint({ json: input }));
	if (!result.ok) return result;
	return {
		ok: true,
		data: savePendingAuth({ email: input.email, role: null, intent: 'sign-in' })
	};
}

/** Re-sends the pending magic link; resolves null when there is nothing pending. */
export async function resendMagicLink(): Promise<ApiResult<PendingAuth, ResendLinkError> | null> {
	const pending = getPendingAuth();
	if (!pending) return null;
	return pending.intent === 'sign-up' && pending.role
		? requestSignUpLink({ email: pending.email, role: pending.role })
		: requestSignInLink({ email: pending.email });
}

/**
 * Verify a magic-link token against better-auth. Without a callbackURL the
 * endpoint responds with JSON (and sets the session cookie); invalid or
 * expired tokens redirect, which we treat as "expired". Admins land on the
 * console; everyone else on the app entry until post-auth homes exist here.
 */
export async function verifyMagicLink(token: string): Promise<VerifyResult> {
	if (!token) {
		return { status: 'expired', destination: '/auth/expired' };
	}
	let res: Response;
	try {
		res = await fetch(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, {
			credentials: 'same-origin',
			redirect: 'manual'
		});
	} catch {
		return { status: 'expired', destination: '/auth/expired' };
	}
	if (!res.ok) {
		return { status: 'expired', destination: '/auth/expired' };
	}
	const { fetchSession } = await import('./profile');
	const session = await fetchSession();
	clearPendingAuth();
	if (session?.role === 'admin') return { status: 'ok', destination: '/admin' };
	if (session?.role === 'service-provider') {
		return { status: 'ok', destination: '/service-provider/dashboard' };
	}
	if (session?.role === 'family') {
		return { status: 'ok', destination: '/family/profile' };
	}
	return { status: 'ok', destination: '/' };
}

export async function signOut(): Promise<void> {
	if (!browser) return;
	try {
		await fetch('/api/auth/sign-out', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: '{}'
		});
	} catch {
		// The server session may outlive a failed request; the local session
		// still ends so the UI signs out either way.
	}
	const { endSession } = await import('./profile');
	endSession();
}
