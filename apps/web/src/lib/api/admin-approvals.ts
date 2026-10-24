/** Admin approval queue + review packet (screens 8a/8b/8c), backed by
 * /admin/approval-requests, /approvals and /admin/kyc-docs. */
import { m } from '$lib/paraglide/messages';
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.admin['approval-requests'].$get;
const detailEndpoint = apiClient.admin['approval-requests'][':id'].$get;
const rejectEndpoint = apiClient.admin['approval-requests'][':id'].reject.$post;
const approveEndpoint = apiClient.approvals.$post;
const revokeEndpoint = apiClient.approvals[':id'].revoke.$post;
const fileUrlEndpoint = apiClient.admin['kyc-docs'][':id']['file-url'].$get;
const expiryEndpoint = apiClient.admin['kyc-docs'][':id'].$patch;
const reviewDocumentEndpoint = apiClient.admin['kyc-docs'][':id'].review.$post;
const safetyFileUrlEndpoint = apiClient.admin['safety-verifications'][':id']['file-url'].$get;
const remarksEndpoint = apiClient.admin['approval-requests'][':id'].remarks.$put;
const flagVouchEndpoint = apiClient.admin.vouches[':id'].flag.$post;
const revokeVouchEndpoint = apiClient.admin.vouches[':id'].revoke.$post;

export type ApprovalQueue = Extract<
	Awaited<ReturnType<typeof listApprovalRequests>>,
	{ ok: true }
>['data'];
export type ApprovalQueueEntry = ApprovalQueue['requests'][number];
export type ApprovalRequestDetail = Extract<
	Awaited<ReturnType<typeof getApprovalRequest>>,
	{ ok: true }
>['data'];
export type KycFileView = Extract<
	Awaited<ReturnType<typeof getKycDocumentFileUrl>>,
	{ ok: true }
>['data'];
export type AdminVouch = ApprovalRequestDetail['vouches'][number];

export type ApprovalQueueError = ErrorsOf<typeof listEndpoint>;
export type ApprovalDetailError = ErrorsOf<typeof detailEndpoint>;
export type ApprovalRejectError = ErrorsOf<typeof rejectEndpoint>;
export type ApprovalApproveError = ErrorsOf<typeof approveEndpoint>;
export type ApprovalRevokeError = ErrorsOf<typeof revokeEndpoint>;
export type KycFileUrlError = ErrorsOf<typeof fileUrlEndpoint>;
export type KycExpiryUpdateError = ErrorsOf<typeof expiryEndpoint>;
export type KycReviewError = ErrorsOf<typeof reviewDocumentEndpoint>;
export type ApprovalBlocker = ApprovalRequestDetail['approvalBlockers'][number];

/** One localized line per approval blocker (UAT #25). The server also sends an
 * English `message`; the web words it from `kind` so French admins read French. */
export function describeApprovalBlocker(
	blocker: Pick<ApprovalBlocker, 'kind'> & { name?: string }
): string {
	const name = blocker.name ?? '';
	switch (blocker.kind) {
		case 'photo_missing':
			return m.admin_requests_blocker_photo_missing();
		case 'document_missing':
			return m.admin_requests_blocker_document_missing({ name });
		case 'document_rejected':
			return m.admin_requests_blocker_document_rejected({ name });
		case 'document_expired':
			return m.admin_requests_blocker_document_expired({ name });
		case 'document_unreviewed':
			return m.admin_requests_blocker_document_unreviewed({ name });
		default:
			return name;
	}
}

export async function listApprovalRequests() {
	return call(listEndpoint());
}

export async function getApprovalRequest(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

export async function rejectApprovalRequest(id: string, reason: string) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: { reason } } as unknown as Parameters<
		typeof rejectEndpoint
	>[0];
	return call(rejectEndpoint(args));
}

export async function approveRequest(input: {
	userId: string;
	approvalRequestId: string;
	/** ISO datetime the approval expires — the dialog requires an explicit date. */
	expiresAt: string;
}) {
	return call(approveEndpoint({ json: input }));
}

/** Revoke a live approval before its expiry — the reason is shown to the provider. */
export async function revokeApproval(approvalId: string, reason: string) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id: approvalId }, json: { reason } } as unknown as Parameters<
		typeof revokeEndpoint
	>[0];
	return call(revokeEndpoint(args));
}

export async function getKycDocumentFileUrl(documentId: string) {
	return call(fileUrlEndpoint({ param: { id: documentId } }));
}

export async function updateKycDocumentExpiry(documentId: string, expiryDate: string | null) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id: documentId }, json: { expiryDate } } as unknown as Parameters<
		typeof expiryEndpoint
	>[0];
	return call(expiryEndpoint(args));
}

/** Approve or reject one submitted document (UAT #27). A rejection needs a reason. */
export async function reviewKycDocument(
	documentId: string,
	input: { decision: 'approve' | 'reject'; reason?: string | null }
) {
	const args = { param: { id: documentId }, json: input } as unknown as Parameters<
		typeof reviewDocumentEndpoint
	>[0];
	return call(reviewDocumentEndpoint(args));
}

/** Short-lived inline link to an uploaded safety-gate document (UAT #29). */
export async function getSafetyDocumentFileUrl(verificationId: string) {
	return call(safetyFileUrlEndpoint({ param: { id: verificationId } }));
}

export async function saveGeneralRemarks(id: string, generalRemarks: string) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: { generalRemarks } } as unknown as Parameters<
		typeof remarksEndpoint
	>[0];
	return call(remarksEndpoint(args));
}

export async function actOnVouch(id: string, action: 'flag' | 'revoke', reason: string) {
	const endpoint = action === 'flag' ? flagVouchEndpoint : revokeVouchEndpoint;
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: { reason } } as unknown as Parameters<typeof endpoint>[0];
	return call(endpoint(args));
}

export type { ApiResult };
