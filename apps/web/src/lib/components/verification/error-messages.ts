/**
 * Localized text for the errors the verification screens show (UAT #3).
 * The API sends English `message`s; a known one is replaced with its
 * translation (the English copy is identical, so nothing changes in
 * English), anything else falls back to a localized message for its code.
 * Every function reads the locale when called — never at module scope.
 */
import { m } from '$lib/paraglide/messages';

interface ServerError {
	code: string;
	message: string;
}

export type ApprovalBlocker =
	| { kind: 'document_missing'; name: string }
	| { kind: 'document_rejected'; name: string }
	| { kind: 'document_unreviewed'; name: string }
	| { kind: 'photo_missing' };

/** Exact server messages → their translation. */
const knownMessages = (): Record<string, () => string> => ({
	// safety verification
	'That check is already in your list.': m.verify_err_already_in_list,
	'Your check list can no longer be changed.': m.verify_err_list_locked,
	'Choose at least one check before starting.': m.verify_err_choose_check,
	'Your previous payment is still being processed. Check back in a few minutes.':
		m.verify_err_payment_processing,
	'A safety verification is already in progress for this account.':
		m.verify_err_already_in_progress,
	'That document cannot be collected through Credibled.': m.verify_err_not_collectable,
	'The document has already expired — submit a current one.': m.verify_err_document_expired,
	'Valid-until date must be after the issue date.': m.verify_err_valid_until_before_issue,
	'Issue date cannot be in the future.': m.verify_err_issue_date_future,
	'You have checks waiting to be fetched by Credibled. Remove them from your check list first, or pay for them, then upload this document.':
		m.verify_err_checks_waiting,
	// KYC documents and uploads
	'Issue date must be a valid date.': m.documents_err_issue_date_invalid,
	'Expiry date is required.': m.documents_err_expiry_required,
	'Expiry date must be a valid future date.': m.documents_err_expiry_future,
	'KYC document type is not available for this role.': m.documents_err_type_unavailable,
	'KYC document type was not found.': m.documents_err_type_not_found,
	'Submit this document through safety verification.': m.documents_err_use_safety_verification,
	'Unsupported verification document file type.': m.documents_err_file_type_verification,
	'Unsupported KYC document file type.': m.documents_err_file_type_kyc,
	'Verification document is too large.': m.documents_err_too_large_verification,
	'KYC document is too large.': m.documents_err_too_large_kyc,
	'Upload request contains invalid or unsupported fields.': m.documents_err_upload_request_invalid
});

const CLASH = /^(.+) already covers this — adding both would charge you twice for one result\.$/;

function known(message: string): string | null {
	const translate = knownMessages()[message];
	if (translate) return translate();
	const clash = CLASH.exec(message);
	return clash ? m.verify_err_clash({ name: clash[1] }) : null;
}

/** Errors from the safety-verification endpoints (order, check list). */
export function safetyVerificationErrorText(error: ServerError): string {
	switch (error.code) {
		case 'TAX_PROVINCE_REQUIRED':
			return m.verify_err_tax_province_required();
		case 'TAX_CONFIGURATION_INCOMPLETE':
			return m.verify_err_tax_configuration();
		// The reason is the payment provider's own (English) wording.
		case 'SAFETY_VERIFICATION_PAYMENT_FAILED':
			return m.verify_err_payment_failed();
		case 'SAFETY_VERIFICATION_CONFLICT':
			return known(error.message) ?? m.verify_err_conflict();
		case 'INVALID_SAFETY_VERIFICATION_INPUT':
			return known(error.message) ?? m.verify_err_invalid_input();
		default:
			return known(error.message) ?? m.verify_error_retry();
	}
}

/** Errors from a document upload (presign, KYC record, safety document). */
export function documentUploadErrorText(error: ServerError): string {
	const translated = known(error.message);
	if (translated) return translated;
	switch (error.code) {
		case 'INVALID_KYC_DOCUMENT':
		case 'INVALID_KYC_DOCUMENT_INPUT':
			return m.documents_err_invalid_document();
		case 'INVALID_UPLOAD':
		case 'INVALID_UPLOAD_PRESIGN_INPUT':
			return m.documents_err_invalid_upload();
		case 'SAFETY_VERIFICATION_CONFLICT':
			return m.verify_err_conflict();
		case 'INVALID_SAFETY_VERIFICATION_INPUT':
			return m.verify_err_invalid_input();
		default:
			return m.common_error_generic();
	}
}

const blockerText = (blocker: ApprovalBlocker): string => {
	switch (blocker.kind) {
		case 'photo_missing':
			return m.approval_blocker_photo_missing();
		case 'document_missing':
			return m.approval_blocker_document_missing({ name: blocker.name });
		case 'document_rejected':
			return m.approval_blocker_document_rejected({ name: blocker.name });
		case 'document_unreviewed':
			return m.approval_blocker_document_unreviewed({ name: blocker.name });
	}
};

/** UAT #12: what is still needed before an approval request can be submitted,
 * built from the structured blockers the API sends with the error. */
export function approvalIncompleteText(
	blockers: ReadonlyArray<ApprovalBlocker> | undefined
): string {
	if (!blockers || blockers.length === 0) return m.approval_incomplete_generic();
	return m.approval_incomplete({ items: blockers.map(blockerText).join('; ') });
}
