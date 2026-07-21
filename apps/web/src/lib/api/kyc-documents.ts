/** Provider KYC document upload (screen 11a): presign → PUT to storage →
 * record the submission, backed by /uploads/presigned-url and /kyc-docs. */
import { apiClient, call, type ApiResult, type ErrorsOf, type UnexpectedError } from './client';

const presignEndpoint = apiClient.uploads['presigned-url'].$post;
const submitEndpoint = apiClient['kyc-docs'].$post;

export type UploadPresignError = ErrorsOf<typeof presignEndpoint>;
export type KycSubmitError = ErrorsOf<typeof submitEndpoint>;
export type KycUploadError = UploadPresignError | KycSubmitError | UnexpectedError;
export type SubmittedKycDocument = Extract<
	Awaited<ReturnType<typeof submitKycDocument>>,
	{ ok: true }
>['data'];

async function submitKycDocument(input: {
	documentTypeId: string;
	filename: string;
	fileKey: string;
	expiryDate: string | null;
}) {
	return call(submitEndpoint({ json: input }));
}

/**
 * Full upload flow for one KYC document. Uploads the raw file to object
 * storage via a presigned URL, then records it as a submitted document.
 */
export async function uploadKycDocument(input: {
	documentTypeId: string;
	file: File;
	/** ISO date string; required when the document type requires an expiry. */
	expiryDate: string | null;
}): Promise<ApiResult<SubmittedKycDocument, KycUploadError>> {
	const presigned = await call(
		presignEndpoint({
			json: {
				target: 'kyc-document',
				documentTypeId: input.documentTypeId,
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
					message: 'The file could not be uploaded to storage.',
					status: uploadRes.status
				}
			};
		}
	} catch {
		return {
			ok: false,
			error: { code: 'UNEXPECTED', message: 'The file upload could not be sent.', status: null }
		};
	}

	return submitKycDocument({
		documentTypeId: input.documentTypeId,
		filename: input.file.name,
		fileKey: presigned.data.fileKey,
		expiryDate: input.expiryDate
	});
}

export type { ApiResult };
