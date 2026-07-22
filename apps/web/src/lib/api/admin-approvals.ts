/** Admin approval queue + review packet (screens 8a/8b/8c), backed by
 * /admin/approval-requests, /approvals and /admin/kyc-docs. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const listEndpoint = apiClient.admin['approval-requests'].$get;
const detailEndpoint = apiClient.admin['approval-requests'][':id'].$get;
const rejectEndpoint = apiClient.admin['approval-requests'][':id'].reject.$post;
const approveEndpoint = apiClient.approvals.$post;
const revokeEndpoint = apiClient.approvals[':id'].revoke.$post;
const fileUrlEndpoint = apiClient.admin['kyc-docs'][':id']['file-url'].$get;
const expiryEndpoint = apiClient.admin['kyc-docs'][':id'].$patch;

export type ApprovalQueue = Extract<Awaited<ReturnType<typeof listApprovalRequests>>, { ok: true }>['data'];
export type ApprovalQueueEntry = ApprovalQueue['requests'][number];
export type ApprovalRequestDetail = Extract<
	Awaited<ReturnType<typeof getApprovalRequest>>,
	{ ok: true }
>['data'];
export type KycFileView = Extract<Awaited<ReturnType<typeof getKycDocumentFileUrl>>, { ok: true }>['data'];

export type ApprovalQueueError = ErrorsOf<typeof listEndpoint>;
export type ApprovalDetailError = ErrorsOf<typeof detailEndpoint>;
export type ApprovalRejectError = ErrorsOf<typeof rejectEndpoint>;
export type ApprovalApproveError = ErrorsOf<typeof approveEndpoint>;
export type ApprovalRevokeError = ErrorsOf<typeof revokeEndpoint>;
export type KycFileUrlError = ErrorsOf<typeof fileUrlEndpoint>;
export type KycExpiryUpdateError = ErrorsOf<typeof expiryEndpoint>;

export async function listApprovalRequests() {
	return call(listEndpoint());
}

export async function getApprovalRequest(id: string) {
	return call(detailEndpoint({ param: { id } }));
}

export async function rejectApprovalRequest(id: string, reason: string) {
	// The API reads the body via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { param: { id }, json: { reason } } as unknown as Parameters<typeof rejectEndpoint>[0];
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

export type { ApiResult };
