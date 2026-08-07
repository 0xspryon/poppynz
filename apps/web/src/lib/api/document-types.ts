/** Admin CRUD for KYC document types (screen 8d), backed by /kyc-docs/types. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient['kyc-docs'].types.$get;
const createEndpoint = apiClient['kyc-docs'].types.$post;
const updateEndpoint = apiClient['kyc-docs'].types[':id'].$patch;
const removeEndpoint = apiClient['kyc-docs'].types[':id'].$delete;

export type DocumentType = Extract<
	Awaited<ReturnType<typeof listDocumentTypes>>,
	{ ok: true }
>['data'][number];
export type DocumentTypeListError = ErrorsOf<typeof listEndpoint>;
export type DocumentTypeMutationError =
	| ErrorsOf<typeof createEndpoint>
	| ErrorsOf<typeof updateEndpoint>;

export interface DocumentTypeDraft {
	name: string;
	isOptional: boolean;
	requiresExpiryDate: boolean;
	isFetchable: boolean;
}

export async function listDocumentTypes() {
	return call(listEndpoint());
}

export async function createDocumentType(draft: DocumentTypeDraft) {
	return call(createEndpoint({ json: draft }));
}

export async function updateDocumentType(id: string, patch: Partial<DocumentTypeDraft>) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof updateEndpoint>[0];
	return call(updateEndpoint(args));
}

export async function removeDocumentType(id: string) {
	return call(removeEndpoint({ param: { id } }));
}

export type { ApiResult };
