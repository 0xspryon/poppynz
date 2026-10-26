/** Terms-and-conditions documents: public role lists (/tcs/:role), the current
 * user's pending/accept endpoints (/me/tcs), and admin CRUD (/admin/tcs). */
import { m } from '$lib/paraglide/messages';
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

/** The languages a T&C version can be written in; English is authoritative. */
export type TcLocale = 'en' | 'fr';

/** Admins are never a T&C audience — "all" covers the non-admin profiles. */
export type TcAudienceRole = 'family' | 'service-provider';
export type TcAppliesToRole = 'all' | TcAudienceRole;

/** "Everyone" / "Families" / "Service providers", localized. */
export const tcAudienceLabel = (role: TcAppliesToRole): string =>
	role === 'all'
		? m.admin_tcs_audience_all()
		: role === 'family'
			? m.admin_tcs_audience_family()
			: m.admin_tcs_audience_provider();

/** Hand-written DTOs instead of the usual endpoint-derived aliases: resolving
 * two of the deep RPC payload types in one file makes svelte-check collapse
 * the second to `never`. The explicit wrapper return annotations below keep
 * these honest — tsc rejects them if the API payloads drift. */

/** A live document flattened with the published version shown to this
 * reader: the translation in their language when there is one, else the
 * authoritative English (`fallback`). */
export interface PublishedTc {
	documentId: string;
	slug: string;
	title: string;
	appliesToRole: TcAppliesToRole;
	versionId: string;
	version: number;
	locale: TcLocale;
	fallback: boolean;
	content: string;
	checkboxLabel: string;
	publishedAt: string | null;
}

export interface TcDocumentSummary {
	id: string;
	slug: string;
	title: string;
	appliesToRole: TcAppliesToRole;
	/** "service_agreement": the written agreement signed on contracts (one
	 * live document, never deleted); "terms": everything the gate shows. */
	kind: 'terms' | 'service_agreement';
	deletedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface AdminTcVersion {
	id: string;
	documentId: string;
	locale: string;
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
	const args = { param: { id }, json: patch } as unknown as Parameters<
		typeof adminUpdateEndpoint
	>[0];
	return call(adminUpdateEndpoint(args));
}

export async function removeTcDocument(
	id: string
): Promise<ApiResult<TcDocumentSummary, ErrorsOf<typeof adminRemoveEndpoint>>> {
	return call(adminRemoveEndpoint({ param: { id } }));
}

/** Draft endpoints act on one language's draft (`?locale=`, English by default). */
export async function createTcDraft(
	id: string,
	draft: TcVersionDraft,
	locale: TcLocale = 'en'
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminCreateDraftEndpoint>>> {
	// Same parseJsonBody caveat as PATCH — the input type omits `json`.
	const args = { param: { id }, query: { locale }, json: draft } as unknown as Parameters<
		typeof adminCreateDraftEndpoint
	>[0];
	return call(adminCreateDraftEndpoint(args));
}

export async function updateTcDraft(
	id: string,
	patch: Partial<TcVersionDraft>,
	locale: TcLocale = 'en'
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminUpdateDraftEndpoint>>> {
	const args = { param: { id }, query: { locale }, json: patch } as unknown as Parameters<
		typeof adminUpdateDraftEndpoint
	>[0];
	return call(adminUpdateDraftEndpoint(args));
}

export async function publishTcDraft(
	id: string,
	locale: TcLocale = 'en'
): Promise<ApiResult<AdminTcVersion, ErrorsOf<typeof adminPublishEndpoint>>> {
	const args = { param: { id }, query: { locale } } as unknown as Parameters<
		typeof adminPublishEndpoint
	>[0];
	return call(adminPublishEndpoint(args));
}

/**
 * The agree sentence beside the checkbox. A translated version carries its
 * own; when a French reader is shown the English text (no translation yet),
 * the sentence is still in their language (U2) — the document stays English.
 */
export function tcCheckboxLabel(tc: Pick<PublishedTc, 'slug' | 'title' | 'checkboxLabel' | 'fallback'>) {
	if (!tc.fallback) return tc.checkboxLabel;
	return tc.slug === 'terms_of_service'
		? m.auth_signup_terms_fallback()
		: m.tc_checkbox_fallback({ title: tc.title });
}

export type { ApiResult };
