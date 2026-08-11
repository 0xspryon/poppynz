/** Admin listing of family searches submitted for follow-up via the find
 * page's no-results escape hatch. Server-paginated, newest first. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.admin['user-searches'].$get;

export type AdminUserSearchList = Extract<
	Awaited<ReturnType<typeof listAdminUserSearches>>,
	{ ok: true }
>['data'];
export type AdminUserSearch = AdminUserSearchList['searches'][number];
export type AdminUserSearchListError = ErrorsOf<typeof listEndpoint>;

export async function listAdminUserSearches(page: number, perPage: number) {
	// The API reads pagination via c.req.query (no hono validator), so the RPC
	// input type omits `query` — the client still serializes it at runtime.
	const args = { query: { page: String(page), perPage: String(perPage) } } as unknown as Parameters<
		typeof listEndpoint
	>[0];
	return call(listEndpoint(args));
}

export type { ApiResult };
