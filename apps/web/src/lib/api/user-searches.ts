/** No-results escape hatch: POSTs the family's full search filter set to
 * /user-searches so a Poppynz administrator can follow up personally. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const createEndpoint = apiClient['user-searches'].$post;

export interface UserSearchDetails {
	q?: string;
	service?: string;
	city?: string;
	radiusKm?: number;
	minHourlyRateCents?: number;
	maxHourlyRateCents?: number;
	sort?: string;
}

export type UserSearchReportError = ErrorsOf<typeof createEndpoint>;

export async function reportUserSearch(details: UserSearchDetails) {
	// The API reads the body via parseJsonBody (no hono validator), so the RPC
	// input type omits `json` — the client still serializes it at runtime.
	const args = { json: details } as unknown as Parameters<typeof createEndpoint>[0];
	return call(createEndpoint(args));
}

export type { ApiResult };
