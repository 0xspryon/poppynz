/** Card disputes (Tier 3 step 4): the words for Stripe's lifecycle, Poppynz's
 * own triage, the bank's reasons, and the toast for each refusal. */
import type { CardDisputeError } from '$lib/api/card-disputes';
import { m } from '$lib/paraglide/messages';

/** The StatusChip statuses (a subset of ChipStatus; plain tsc can't read a
 * .svelte module's types). */
export type DisputeChip =
	| 'approved'
	| 'complete'
	| 'rejected'
	| 'empty'
	| 'in-progress'
	| 'proposed';

export const cardDisputeStatusLabel = (status: string): string => {
	switch (status) {
		case 'warning_needs_response':
			return m.admin_card_disputes_status_warning_needs_response();
		case 'warning_under_review':
			return m.admin_card_disputes_status_warning_under_review();
		case 'warning_closed':
			return m.admin_card_disputes_status_warning_closed();
		case 'needs_response':
			return m.admin_card_disputes_status_needs_response();
		case 'under_review':
			return m.admin_card_disputes_status_under_review();
		case 'won':
			return m.admin_card_disputes_status_won();
		case 'lost':
			return m.admin_card_disputes_status_lost();
		case 'prevented':
			return m.admin_card_disputes_status_prevented();
		default:
			return status;
	}
};

export const cardDisputeStatusChip = (status: string): DisputeChip => {
	switch (status) {
		case 'won':
		case 'warning_closed':
		case 'prevented':
			return 'approved';
		case 'lost':
			return 'rejected';
		case 'under_review':
		case 'warning_under_review':
			return 'in-progress';
		default:
			return 'proposed';
	}
};

export const cardDisputeTriageLabel = (triage: string): string => {
	switch (triage) {
		case 'needs_response':
			return m.admin_card_disputes_triage_needs_response();
		case 'evidence_submitted':
			return m.admin_card_disputes_triage_evidence_submitted();
		case 'allocation_needed':
			return m.admin_card_disputes_triage_allocation_needed();
		case 'resolved':
			return m.admin_card_disputes_triage_resolved();
		default:
			return triage;
	}
};

export const cardDisputeReasonLabel = (reason: string): string => {
	switch (reason) {
		case 'fraudulent':
			return m.admin_card_disputes_reason_fraudulent();
		case 'product_not_received':
			return m.admin_card_disputes_reason_product_not_received();
		case 'duplicate':
			return m.admin_card_disputes_reason_duplicate();
		case 'unrecognized':
			return m.admin_card_disputes_reason_unrecognized();
		case 'credit_not_processed':
			return m.admin_card_disputes_reason_credit_not_processed();
		case 'subscription_canceled':
			return m.admin_card_disputes_reason_subscription_canceled();
		default:
			return m.admin_card_disputes_reason_other({ reason: reason.replaceAll('_', ' ') });
	}
};

export const cardDisputeScopeLabel = (scope: string): string =>
	scope === 'cycle'
		? m.admin_card_disputes_scope_cycle()
		: scope === 'extra_session'
			? m.admin_card_disputes_scope_extra_session()
			: m.admin_card_disputes_scope_payment();

export const suspensionReasonLabel = (reason: string | null): string =>
	reason === 'suspected_fraud'
		? m.admin_card_disputes_suspend_reason_suspected_fraud()
		: m.admin_card_disputes_suspend_reason_unreliable_payment_method();

export const cardDisputeErrorMessage = (error: CardDisputeError): string => {
	switch (error.code) {
		case 'CARD_DISPUTE_NOT_FOUND':
			return m.admin_card_disputes_error_not_found();
		case 'FORBIDDEN':
			return m.admin_card_disputes_error_forbidden();
		case 'CARD_DISPUTE_NOT_OPEN':
			return m.admin_card_disputes_error_not_open();
		case 'CARD_DISPUTE_EVIDENCE_SUBMITTED':
			return m.admin_card_disputes_error_submitted();
		case 'CARD_DISPUTE_SUMMARY_REQUIRED':
		case 'INVALID_CARD_DISPUTE_SUMMARY':
			return m.admin_card_disputes_summary_missing();
		case 'CARD_DISPUTE_NOT_LOST':
			return m.admin_card_disputes_error_not_lost();
		case 'CARD_DISPUTE_UNKNOWN_SESSION':
			return m.admin_card_disputes_error_session();
		case 'CARD_DISPUTE_ALREADY_ALLOCATED':
			return m.admin_card_disputes_error_already_allocated();
		case 'CARD_DISPUTE_REASON_REQUIRED':
			return m.admin_card_disputes_allocate_missing();
		case 'CARD_DISPUTE_FORFEIT_TOO_HIGH':
			return m.admin_card_disputes_error_forfeit();
		case 'CARD_DISPUTE_EVIDENCE_REFUSED':
			return m.admin_card_disputes_error_refused();
		case 'CARD_DISPUTE_PROVIDER_UNAVAILABLE':
			return m.admin_card_disputes_error_provider();
		case 'FAMILY_NOTHING_TO_SUSPEND':
			return m.admin_card_disputes_error_nothing_to_suspend();
		case 'FAMILY_NOTHING_TO_RESUME':
			return m.admin_card_disputes_error_nothing_to_resume();
		case 'INVALID_FAMILY_SUSPENSION':
			return m.admin_card_disputes_suspend_missing();
		case 'INVALID_FAMILY_RESUME':
			return m.admin_card_disputes_resume_missing();
		case 'INVALID_CARD_DISPUTE_ALLOCATION':
			return m.admin_card_disputes_allocate_missing();
		case 'INVALID_CARD_DISPUTE_ID':
		case 'INVALID_CARD_DISPUTE_USER':
		case 'INVALID_CARD_DISPUTE_FILTER':
			return m.admin_card_disputes_error_invalid();
		case 'UNEXPECTED':
			return error.status === null ? m.common_error_network() : m.common_error_generic();
		default:
			return m.admin_card_disputes_error_generic();
	}
};
