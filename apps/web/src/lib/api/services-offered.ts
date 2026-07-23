/** Provider services & rates (screen 10a/10b/10c), backed by
 * /me/services-offered. Rates are integer cents; catalogue-linked services
 * are floor-validated server-side. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.me['services-offered'].$get;
const createEndpoint = apiClient.me['services-offered'].$post;
const updateEndpoint = apiClient.me['services-offered'][':id'].$patch;
const removeEndpoint = apiClient.me['services-offered'][':id'].$delete;

export type ServicesOfferedList = Extract<
	Awaited<ReturnType<typeof listServicesOffered>>,
	{ ok: true }
>['data'];
export type ServiceOffered = ServicesOfferedList['services'][number];
export type ServicesListError = ErrorsOf<typeof listEndpoint>;
export type ServiceMutationError = ErrorsOf<typeof createEndpoint> | ErrorsOf<typeof updateEndpoint>;
export type ServiceRemoveError = ErrorsOf<typeof removeEndpoint>;

export interface ServiceOfferedDraft {
	name: string;
	description?: string | null;
	hourlyRateCents: number;
	catalogueServiceId?: string | null;
}

export async function listServicesOffered() {
	return call(listEndpoint());
}

export async function createServiceOffered(draft: ServiceOfferedDraft) {
	return call(createEndpoint({ json: draft }));
}

export async function updateServiceOffered(id: string, patch: Partial<ServiceOfferedDraft>) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof updateEndpoint>[0];
	return call(updateEndpoint(args));
}

export async function removeServiceOffered(id: string) {
	return call(removeEndpoint({ param: { id } }));
}

export type { ApiResult };
