/** Admin user directory (12b) + ban/impersonation actions (12c/12d).
 * The listing comes from our API; ban/unban/impersonate go straight to the
 * better-auth admin plugin endpoints under /api/auth/admin/*. */
import { apiClient, call, type ApiResult, type ErrorsOf, type UnexpectedError } from './client';

const listEndpoint = apiClient.admin.users.$get;

export type AdminUserList = Extract<Awaited<ReturnType<typeof listAdminUsers>>, { ok: true }>['data'];
export type AdminUser = AdminUserList['users'][number];
export type AdminUserListError = ErrorsOf<typeof listEndpoint>;

export async function listAdminUsers() {
	return call(listEndpoint());
}

/** better-auth admin endpoints respond with a bare JSON body (no `error`
 * envelope); failures carry `{ code?, message? }`. Lift both into ApiResult. */
async function authAdminPost<TData>(
	path: string,
	body: Record<string, unknown>
): Promise<ApiResult<TData, UnexpectedError>> {
	let res: Response;
	try {
		res = await fetch(`/api/auth/admin/${path}`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		return { ok: false, error: { code: 'UNEXPECTED', message: 'The request could not be sent.', status: null } };
	}
	let parsed: unknown = null;
	try {
		parsed = await res.json();
	} catch {
		// non-JSON body — handled below
	}
	if (!res.ok) {
		const message =
			typeof parsed === 'object' && parsed !== null && 'message' in parsed
				? String((parsed as { message: unknown }).message)
				: 'The server sent an unexpected response.';
		return { ok: false, error: { code: 'UNEXPECTED', message, status: res.status } };
	}
	return { ok: true, data: parsed as TData };
}

export async function banUser(userId: string, banReason?: string) {
	return authAdminPost<{ user: unknown }>('ban-user', { userId, ...(banReason ? { banReason } : {}) });
}

export async function unbanUser(userId: string) {
	return authAdminPost<{ user: unknown }>('unban-user', { userId });
}

/** Swaps the admin's session for a 1-hour session as the target user; the
 * admin session is parked in better-auth's admin_session cookie. */
export async function impersonateUser(userId: string) {
	return authAdminPost<{ session: unknown; user: unknown }>('impersonate-user', { userId });
}

/** Ends impersonation and restores the parked admin session. */
export async function stopImpersonating() {
	return authAdminPost<{ session: unknown }>('stop-impersonating', {});
}
