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

export type AuthDestination = '/' | '/auth/expired';

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
