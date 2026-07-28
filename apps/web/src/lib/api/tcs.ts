/** Terms-and-conditions documents: public role lists (/tcs/:role), the current
 * user's pending/accept endpoints (/me/tcs), and admin CRUD (/admin/tcs). */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const publishedEndpoint = apiClient.tcs[':role'].$get;
const pendingEndpoint = apiClient.me.tcs.pending.$get;
const acceptEndpoint = apiClient.me.tcs.accept.$post;
const adminListEndpoint = apiClient.admin.tcs.$get;
const adminGetEndpoint = apiClient.admin.tcs[':id'].$get;
const adminCreateEndpoint = apiClient.admin.tcs.$post;
const adminUpdateEndpoint = apiClient.admin.tcs[':id'].$patch;
const adminRemoveEndpoint = apiClient.admin.tcs[':id'].$delete;
const adminCreateDraftEndpoint = apiClient.admin.tcs[':id'].draft.$post;
const adminUpdateDraftEndpoint = apiClient.admin.tcs[':id'].draft.$patch;
const adminPublishEndpoint = apiClient.admin.tcs[':id'].publish.$post;

/** Admins are never a T&C audience — "all" covers the non-admin profiles. */
export type TcAudienceRole = 'family' | 'service-provider';
export type TcAppliesToRole = 'all' | TcAudienceRole;

/** Hand-written DTOs instead of the usual endpoint-derived aliases: resolving
 * two of the deep RPC payload types in one file makes svelte-check collapse
 * the second to `never`. The explicit wrapper return annotations below keep
 * these honest — tsc rejects them if the API payloads drift. */

/** A live document flattened with its latest published version. */
export interface PublishedTc {
	documentId: string;
	slug: string;
	title: string;
	appliesToRole: TcAppliesToRole;
	versionId: string;
	version: number;
	content: string;
	checkboxLabel: string;
	publishedAt: string | null;
}

export interface TcDocumentSummary {
	id: string;
	slug: string;
	title: string;
	appliesToRole: TcAppliesToRole;
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AdminTcVersion {
	id: string;
	documentId: string;
	version: number;
	description: string;
	content: string;
	checkboxLabel: string;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AdminTcDocument extends TcDocumentSummary {
	versions: Array<AdminTcVersion>;
}

export type TcPendingError = ErrorsOf<typeof pendingEndpoint>;
export type TcAcceptError = ErrorsOf<typeof acceptEndpoint>;
export type TcAdminListError = ErrorsOf<typeof adminListEndpoint>;
export type TcAdminMutationError =
	| ErrorsOf<typeof adminCreateEndpoint>
	| ErrorsOf<typeof adminCreateDraftEndpoint>
	| ErrorsOf<typeof adminPublishEndpoint>;

export interface TcDocumentDraft {
	slug: string;
	title: string;
	appliesToRole: TcAppliesToRole;
}

export interface TcVersionDraft {
	description: string;
	content: string;
	checkboxLabel: string;
}

/** Public — signup shows the terms before a session exists. */
export async function listPublishedTcs(
	role: TcAudienceRole
): Promise<ApiResult<Array<PublishedTc>, ErrorsOf<typeof publishedEndpoint>>> {
	return call(publishedEndpoint({ param: { role } }));
}

/** Live documents for the signed-in user's role they have not accepted yet. */
export async function listPendingTcs(): Promise<ApiResult<Array<PublishedTc>, TcPendingError>> {
	return call(pendingEndpoint());
}

export async function acceptTcs(acceptances: Array<{ slug: string; versionId: string }>) {
	return call(acceptEndpoint({ json: { acceptances } }));
}

export async function listAdminTcs(): Promise<ApiResult<Array<AdminTcDocument>, TcAdminListError>> {
	return call(adminListEndpoint());
}

export async function getAdminTc(
	id: string
): Promise<ApiResult<AdminTcDocument, ErrorsOf<typeof adminGetEndpoint>>> {
	return call(adminGetEndpoint({ param: { id } }));
}

export async function createTcDocument(
	draft: TcDocumentDraft
): Promise<ApiResult<TcDocumentSummary, ErrorsOf<typeof adminCreateEndpoint>>> {
	return call(adminCreateEndpoint({ json: draft }));
}

export async function updateTcDocument(
	id: string,
	patch: Partial<Omit<TcDocumentDraft, 'slug'>>
): Promise<ApiResult<TcDocumentSummary, ErrorsOf<typeof adminUpdateEndpoint>>> {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof adminUpdateEndpoint>[0];
	return call(adminUpdateEndpoint(args));
}

export async function removeTcDocument(
	id: string
): Promise<ApiResult<TcDocumentSummary, ErrorsOf<typeof adminRemoveEndpoint>>> {
	return call(adminRemoveEndpoint({ param: { id } }));
}

export async function createTcDraft(
	id: string,
	draft: TcVersionDraft
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminCreateDraftEndpoint>>> {
	// Same parseJsonBody caveat as PATCH — the input type omits `json`.
	const args = { param: { id }, json: draft } as unknown as Parameters<
		typeof adminCreateDraftEndpoint
	>[0];
	return call(adminCreateDraftEndpoint(args));
}

export async function updateTcDraft(
	id: string,
	patch: Partial<TcVersionDraft>
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminUpdateDraftEndpoint>>> {
	const args = { param: { id }, json: patch } as unknown as Parameters<typeof adminUpdateDraftEndpoint>[0];
	return call(adminUpdateDraftEndpoint(args));
}

export async function publishTcDraft(
	id: string
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminPublishEndpoint>>> {
	return call(adminPublishEndpoint({ param: { id } }));
}

export type { ApiResult };
