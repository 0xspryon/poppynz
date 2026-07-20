/** Admin CRUD for the service catalogue (screen 8e) + the provider-facing
 * live list, backed by /admin/service-catalogue and /service-catalogue. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const adminListEndpoint = apiClient.admin['service-catalogue'].$get;
const createEndpoint = apiClient.admin['service-catalogue'].$post;
const updateEndpoint = apiClient.admin['service-catalogue'][':id'].$patch;
const removeEndpoint = apiClient.admin['service-catalogue'][':id'].$delete;
const liveListEndpoint = apiClient['service-catalogue'].$get;

export type CatalogueItem = Extract<Awaited<ReturnType<typeof listCatalogue>>, { ok: true }>['data'][number];
export type CatalogueListError = ErrorsOf<typeof adminListEndpoint>;
export type CatalogueMutationError = ErrorsOf<typeof createEndpoint> | ErrorsOf<typeof updateEndpoint>;

export interface CatalogueItemDraft {
	name: string;
	category: string;
	baseHourlyRateCents: number;
	isLive: boolean;
}

/** Admin view: every non-deleted item, hidden ones included. */
export async function listCatalogue() {
	return call(adminListEndpoint());
}

/** Provider view: live items only — what the services picker offers. */
export async function listLiveCatalogue() {
	return call(liveListEndpoint());
}

export async function createCatalogueItem(draft: CatalogueItemDraft) {
	return call(createEndpoint({ json: draft }));
}

export async function updateCatalogueItem(id: string, patch: Partial<CatalogueItemDraft>) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof updateEndpoint>[0];
	return call(updateEndpoint(args));
}

export async function removeCatalogueItem(id: string) {
	return call(removeEndpoint({ param: { id } }));
}

export type { ApiResult };
