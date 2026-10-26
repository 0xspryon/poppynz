/** The written service agreement (UAT round 2, item 4): what a party is about
 * to sign (/contracts/:id/agreement), the signed snapshots
 * (/contracts/:id/agreement/signed), and the admin template tools
 * (/admin/tcs/:id/preview, /admin/tcs/agreement-signatures). */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';
import type { TcLocale } from './tcs';

const toSignEndpoint = apiClient.contracts[':id'].agreement.$get;
const signedEndpoint = apiClient.contracts[':id'].agreement.signed.$get;
const previewEndpoint = apiClient.admin.tcs[':id'].preview.$post;
const signaturesEndpoint = apiClient.admin.tcs['agreement-signatures'].$get;

/** Hand-written DTOs, as in tcs.ts: several deep RPC payload types in one
 * file make svelte-check collapse them to `never`. The wrapper return
 * annotations keep them honest — tsc rejects drift. */

/** What the signer echoes back: the template row and the hash of the text. */
export interface AgreementAssent {
	versionId: string;
	sha256: string;
}

export interface AgreementToSign {
	side: 'family' | 'helper';
	contractVersion: number;
	documentId: string;
	title: string;
	versionId: string;
	version: number;
	locale: TcLocale;
	/** The reader's language has no translation of this revision: English shown. */
	fallback: boolean;
	checkboxLabel: string;
	content: string;
	sha256: string;
	cancellationPolicyVersion: number | null;
}

export interface AgreementSignature {
	id: string;
	side: 'family' | 'helper';
	signerName: string;
	contractVersion: number;
	templateVersion: number;
	locale: TcLocale;
	sha256: string;
	cancellationPolicyVersion: number | null;
	signedAt: string;
	voidedAt: string | null;
	/** A live signature on the terms in force (or proposed). */
	counts: boolean;
	content: string;
}

export interface SignedAgreement {
	contractId: string;
	title: string | null;
	contractVersion: number | null;
	/** Newest first. */
	signatures: Array<AgreementSignature>;
}

export type AgreementPlaceholder = {
	name: string;
	kind: 'text' | 'flag' | 'list';
	/** The list section the name is read inside, or null at the top level. */
	within: string | null;
};

export type AgreementTemplateIssue = {
	code:
		| 'unknown_placeholder'
		| 'list_as_value'
		| 'unclosed_section'
		| 'mismatched_section'
		| 'unexpected_close'
		| 'malformed_tag';
	name: string;
	line: number;
};

export interface AgreementTemplatePreview {
	kind: 'terms' | 'service_agreement';
	/** Null when the draft has issues. */
	content: string | null;
	issues: Array<AgreementTemplateIssue>;
	placeholders: Array<AgreementPlaceholder>;
}

export interface AdminAgreementSignature {
	id: string;
	contractId: string;
	contractVersion: number;
	side: 'family' | 'helper';
	signerName: string;
	signerEmail: string;
	templateVersion: number;
	locale: string;
	sha256: string;
	signedAt: string;
	voidedAt: string | null;
}

export async function getAgreementToSign(
	contractId: string
): Promise<ApiResult<{ agreement: AgreementToSign }, ErrorsOf<typeof toSignEndpoint>>> {
	return call(toSignEndpoint({ param: { id: contractId } }));
}

export async function getSignedAgreement(
	contractId: string
): Promise<ApiResult<{ agreement: SignedAgreement }, ErrorsOf<typeof signedEndpoint>>> {
	return call(signedEndpoint({ param: { id: contractId } }));
}

export async function previewAgreementTemplate(
	documentId: string,
	content: string,
	locale: TcLocale
): Promise<ApiResult<AgreementTemplatePreview, ErrorsOf<typeof previewEndpoint>>> {
	// The API reads the body via parseJsonBody, so the RPC input type omits
	// `json` — the client still serializes it at runtime.
	const args = { param: { id: documentId }, json: { content, locale } } as unknown as Parameters<
		typeof previewEndpoint
	>[0];
	return call(previewEndpoint(args));
}

export async function listAgreementSignatures(): Promise<
	ApiResult<Array<AdminAgreementSignature>, ErrorsOf<typeof signaturesEndpoint>>
> {
	return call(signaturesEndpoint());
}

/** The first characters of a hash, enough to compare two texts by eye. */
export const shortHash = (sha256: string) => sha256.slice(0, 12);

export type { ApiResult };
