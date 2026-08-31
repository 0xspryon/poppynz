/** Poppynz safety verification — both routes to being verified, plus the
 * admin review queue. Backed by /safety-verification and
 * /admin/safety-verifications. */
import { apiClient, call, type ApiResult, type ErrorsOf, type UnexpectedError } from './client';

const getEndpoint = apiClient['safety-verification'].$get;
const orderEndpoint = apiClient['safety-verification'].order.$post;
const addItemEndpoint = apiClient['safety-verification'].items.$post;
const removeItemEndpoint = apiClient['safety-verification'].items[':itemId'].$delete;
const documentEndpoint = apiClient['safety-verification'].document.$post;
const presignEndpoint = apiClient.uploads['presigned-url'].$post;
const adminListEndpoint = apiClient.admin['safety-verifications'].$get;
const adminDecideEndpoint = apiClient.admin['safety-verifications'][':id'].decision.$post;
const adminReportEndpoint = apiClient.admin['safety-verifications'][':id'].report;

export type SafetyVerificationState = Extract<
	Awaited<ReturnType<typeof getSafetyVerification>>,
	{ ok: true }
>['data'];
export type SafetyVerificationStatus = SafetyVerificationState['verification']['status'];
export type AdminSafetyVerification = Extract<
	Awaited<ReturnType<typeof listSafetyVerificationsForReview>>,
	{ ok: true }
>['data']['verifications'][number];

export type SafetyVerificationError = ErrorsOf<typeof getEndpoint>;
export type SafetyVerificationMutationError =
	| ErrorsOf<typeof orderEndpoint>
	| ErrorsOf<typeof addItemEndpoint>
	| ErrorsOf<typeof documentEndpoint>
	// The upload flow presigns first, so its failures surface here too.
	| ErrorsOf<typeof presignEndpoint>
	| UnexpectedError;

export async function getSafetyVerification() {
	return call(getEndpoint());
}

/** Adds a check to the applicant's list. The price and Credibled check type
 * are resolved server-side from the document type. */
export async function addSafetyVerificationItem(documentTypeId: string) {
	return call(addItemEndpoint({ json: { documentTypeId } }));
}

export async function removeSafetyVerificationItem(itemId: string) {
	return call(removeItemEndpoint({ param: { itemId } }));
}

export async function orderSafetyCheck() {
	return call(orderEndpoint({ json: { consentAccepted: true } }));
}

export interface SafetyDocumentSubmission {
	file: File;
	issuingAuthority: string;
	documentNumber: string;
	issuedOn: string;
	expiresOn: string;
}

/**
 * Upload flow for an existing vulnerable-sector document: presign → PUT to the
 * private bucket → record the submission.
 *
 * The resulting record is `review_required`, never verified — a document is
 * not evidence of its own authenticity.
 */
export async function submitSafetyDocument(
	input: SafetyDocumentSubmission
): Promise<ApiResult<unknown, SafetyVerificationMutationError>> {
	const presigned = await call(
		presignEndpoint({
			json: {
				target: 'safety-verification-document',
				fileName: input.file.name,
				contentType: input.file.type || 'application/octet-stream',
				sizeBytes: input.file.size
			}
		})
	);
	if (!presigned.ok) return presigned;

	try {
		const uploadRes = await fetch(presigned.data.uploadUrl, {
			method: 'PUT',
			headers: { 'content-type': input.file.type || 'application/octet-stream' },
			body: input.file
		});
		if (!uploadRes.ok) {
			return {
				ok: false,
				error: {
					code: 'UNEXPECTED',
					message: 'The document could not be uploaded.',
					status: uploadRes.status
				}
			};
		}
	} catch {
		return {
			ok: false,
			error: { code: 'UNEXPECTED', message: 'The document upload could not be sent.', status: null }
		};
	}

	return call(
		documentEndpoint({
			json: {
				consentAccepted: true,
				issuingAuthority: input.issuingAuthority,
				documentNumber: input.documentNumber,
				filename: input.file.name,
				fileKey: presigned.data.fileKey,
				issuedOn: input.issuedOn,
				expiresOn: input.expiresOn
			}
		})
	);
}

export async function listSafetyVerificationsForReview() {
	return call(adminListEndpoint());
}

export async function decideSafetyVerification(
	id: string,
	decision: { decision: 'approve' | 'reject'; reason?: string; expiresOn?: string }
) {
	// The API reads this body via parseJsonBody (no hono validator), so the RPC
	// input type omits `json` — the client still serializes it at runtime. Same
	// workaround as document-types.ts.
	const args = { param: { id }, json: decision } as unknown as Parameters<
		typeof adminDecideEndpoint
	>[0];
	return call(adminDecideEndpoint(args));
}

/**
 * Direct URL for a screening report.
 *
 * Built from the RPC client rather than hand-written so it can't drift from
 * the API's base path. The endpoint itself is admin-only and sends
 * `cache-control: no-store` — this is just the address, not the authority.
 */
export function safetyVerificationReportUrl(id: string) {
	return adminReportEndpoint.$url({ param: { id } }).toString();
}

export type { ApiResult };
