/** Family "services I need" list, backed by /me/services-needed. Needs carry
 * no rates — families describe what they're looking for, providers price it.
 * Registering at least one need (plus a saved location) makes the family
 * discoverable to approved providers. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.me['services-needed'].$get;
const createEndpoint = apiClient.me['services-needed'].$post;
const updateEndpoint = apiClient.me['services-needed'][':id'].$patch;
const removeEndpoint = apiClient.me['services-needed'][':id'].$delete;

export type ServicesNeededList = Extract<
	Awaited<ReturnType<typeof listServicesNeeded>>,
	{ ok: true }
>['data'];
export type ServiceNeeded = ServicesNeededList['services'][number];
export type NeedsListError = ErrorsOf<typeof listEndpoint>;
export type NeedMutationError = ErrorsOf<typeof createEndpoint> | ErrorsOf<typeof updateEndpoint>;
export type NeedRemoveError = ErrorsOf<typeof removeEndpoint>;

export interface ServiceNeededDraft {
	name: string;
	description?: string | null;
	catalogueServiceId?: string | null;
}

export async function listServicesNeeded() {
	return call(listEndpoint());
}

export async function createServiceNeeded(draft: ServiceNeededDraft) {
	return call(createEndpoint({ json: draft }));
}

export async function updateServiceNeeded(id: string, patch: Partial<ServiceNeededDraft>) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof updateEndpoint>[0];
	return call(updateEndpoint(args));
}

export async function removeServiceNeeded(id: string) {
	return call(removeEndpoint({ param: { id } }));
}

export type { ApiResult };
