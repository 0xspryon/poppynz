/** Family marketplace: vetted-provider search + public provider profiles,
 * backed by /providers/search and /providers/:userId. Radius searches are
 * centered server-side on the family's saved profile location. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const searchEndpoint = apiClient.providers.search.$get;
const detailEndpoint = apiClient.providers[':userId'].$get;

export type ProviderSearchSort = 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest';

export interface ProviderSearchParams {
	q?: string;
	service?: string;
	city?: string;
	radiusKm?: number;
	minHourlyRateCents?: number;
	maxHourlyRateCents?: number;
	sort?: ProviderSearchSort;
	page?: number;
	perPage?: number;
}

export type ProviderSearchData = Extract<
	Awaited<ReturnType<typeof searchProviders>>,
	{ ok: true }
>['data'];
export type ProviderHit = ProviderSearchData['providers'][number];
export type ProviderDetail = Extract<Awaited<ReturnType<typeof getProvider>>, { ok: true }>['data'];
export type ProviderSearchError = ErrorsOf<typeof searchEndpoint>;
export type ProviderDetailError = ErrorsOf<typeof detailEndpoint>;

export async function searchProviders(params: ProviderSearchParams) {
	const query: Record<string, string> = {};
	if (params.q) query.q = params.q;
	if (params.service) query.service = params.service;
	if (params.city) query.city = params.city;
	if (params.radiusKm !== undefined) query.radiusKm = String(params.radiusKm);
	if (params.minHourlyRateCents !== undefined)
		query.minHourlyRateCents = String(params.minHourlyRateCents);
	if (params.maxHourlyRateCents !== undefined)
		query.maxHourlyRateCents = String(params.maxHourlyRateCents);
	if (params.sort) query.sort = params.sort;
	if (params.page !== undefined) query.page = String(params.page);
	if (params.perPage !== undefined) query.perPage = String(params.perPage);

	// The API reads search params via c.req.query (no hono validator), so the
	// RPC input type omits `query` — the client still serializes it at runtime.
	const args = { query } as unknown as Parameters<typeof searchEndpoint>[0];
	return call(searchEndpoint(args));
}

export async function getProvider(userId: string) {
	return call(detailEndpoint({ param: { userId } }));
}

export type { ApiResult };
