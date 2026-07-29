/** Provider-side family search: families looking for help, backed by
 * /families/search and /families/:userId. Only approved providers may search;
 * the API answers PROVIDER_NOT_APPROVED (403) otherwise. Radius searches are
 * centered server-side on the provider's saved profile location. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const searchEndpoint = apiClient.families.search.$get;
const detailEndpoint = apiClient.families[':userId'].$get;

export type FamilySearchSort = 'relevance' | 'distance' | 'newest';

export interface FamilySearchParams {
	q?: string;
	service?: string;
	city?: string;
	radiusKm?: number;
	sort?: FamilySearchSort;
	page?: number;
	perPage?: number;
}

export type FamilySearchData = Extract<
	Awaited<ReturnType<typeof searchFamilies>>,
	{ ok: true }
>['data'];
export type FamilyHit = FamilySearchData['families'][number];
export type FamilyDetail = Extract<Awaited<ReturnType<typeof getFamily>>, { ok: true }>['data'];
export type FamilySearchError = ErrorsOf<typeof searchEndpoint>;
export type FamilyDetailError = ErrorsOf<typeof detailEndpoint>;

export async function searchFamilies(params: FamilySearchParams) {
	const query: Record<string, string> = {};
	if (params.q) query.q = params.q;
	if (params.service) query.service = params.service;
	if (params.city) query.city = params.city;
	if (params.radiusKm !== undefined) query.radiusKm = String(params.radiusKm);
	if (params.sort) query.sort = params.sort;
	if (params.page !== undefined) query.page = String(params.page);
	if (params.perPage !== undefined) query.perPage = String(params.perPage);

	// The API reads search params via c.req.query (no hono validator), so the
	// RPC input type omits `query` — the client still serializes it at runtime.
	const args = { query } as unknown as Parameters<typeof searchEndpoint>[0];
	return call(searchEndpoint(args));
}

export async function getFamily(userId: string) {
	return call(detailEndpoint({ param: { userId } }));
}

export type { ApiResult };
