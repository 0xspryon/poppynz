/** Session money (Tier 3 step 2): the words for what an action would do to
 * a session's money, a refund's or a transfer's status, and the toast for
 * each refusal of the admins' money queues. Every amount comes from the API. */
import type { AdminMoneyError } from '$lib/api/admin-money';
import type { SessionMoneyPreview } from '$lib/api/session-money';
import { formatMoney } from '$lib/money';
import { m } from '$lib/paraglide/messages';

/** The StatusChip statuses money reads in (a subset of ChipStatus; plain
 * tsc can't read a .svelte module's types). */
export type MoneyChip = 'approved' | 'complete' | 'rejected' | 'empty' | 'in-progress' | 'proposed';

/** "Maria receives $15.63, you get $50.39 back" — the outcome stated before
 * confirming, from the viewer's side. Null when there is nothing to say. */
export const previewSentence = (
	preview: SessionMoneyPreview | null,
	viewerSide: 'family' | 'provider',
	name: string
): string | null => {
	if (preview === null || preview.outcome === 'none') return null;
	if (preview.held) return m.money_preview_held();
	const helper = formatMoney(preview.helperReceivesCents);
	const back = formatMoney(preview.familyBackCents);
	if (viewerSide === 'family') {
		if (preview.familyBackCents === 0) return m.money_preview_family_nothing_back({ name, helper });
		return preview.charged
			? m.money_preview_family_back({ name, helper, back })
			: m.money_preview_family_not_charged({ name, helper, back });
	}
	if (preview.familyBackCents === 0) return m.money_preview_helper_nothing_back({ helper });
	return preview.charged
		? m.money_preview_helper_back({ name, helper, back })
		: m.money_preview_helper_not_charged({ name, helper, back });
};

export type RefundStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export const refundStatusChip = (status: RefundStatus): { label: string; status: MoneyChip } => {
	switch (status) {
		case 'pending':
			return { label: m.refunds_status_pending(), status: 'in-progress' };
		case 'succeeded':
			return { label: m.refunds_status_succeeded(), status: 'approved' };
		case 'failed':
			return { label: m.refunds_status_failed(), status: 'rejected' };
		case 'cancelled':
			return { label: m.refunds_status_cancelled(), status: 'empty' };
	}
};

export type SessionMechanism =
	| 'excluded'
	| 'reduced_capture'
	| 'refund'
	| 'refund_recovery'
	| 'held'
	| 'none';

/** How the session's money was settled, when it is worth saying. */
export const mechanismLabel = (
	mechanism: SessionMechanism | (string & {}) | null,
	viewerSide: 'family' | 'provider'
): string | null => {
	switch (mechanism) {
		case 'excluded':
			return m.money_mechanism_excluded();
		case 'reduced_capture':
			return m.money_mechanism_reduced_capture();
		case 'refund':
			return viewerSide === 'family' ? null : m.money_mechanism_refund();
		case 'refund_recovery':
			return viewerSide === 'family' ? null : m.money_mechanism_refund_recovery();
		case 'held':
			return m.money_mechanism_held();
		default:
			return null;
	}
};

/** A cycle transfer's status, as the helper reads it on the cycle page. */
export type CycleTransferStatus =
	| 'due'
	| 'paused'
	| 'sending'
	| 'sent'
	| 'paid'
	| 'failed'
	| 'settled'
	| 'manual_review'
	| 'manual_paid';

export const cycleTransferChip = (
	status: CycleTransferStatus
): { label: string; status: MoneyChip } => {
	switch (status) {
		case 'due':
			return { label: m.transfers_status_scheduled(), status: 'proposed' };
		case 'paused':
			return { label: m.transfers_status_held(), status: 'in-progress' };
		case 'sending':
			return { label: m.transfers_status_sending(), status: 'in-progress' };
		case 'sent':
			return { label: m.transfers_status_arriving(), status: 'in-progress' };
		case 'paid':
			return { label: m.transfers_status_sent(), status: 'approved' };
		case 'failed':
			return { label: m.transfers_status_failed(), status: 'rejected' };
		case 'settled':
			return { label: m.transfers_status_nothing_due(), status: 'empty' };
		case 'manual_review':
			return { label: m.transfers_status_review(), status: 'in-progress' };
		case 'manual_paid':
			return { label: m.transfers_status_paid_manually(), status: 'approved' };
	}
};

/** A transfer's status on the helper's Payouts page. */
export type HelperTransferStatus =
	| 'scheduled'
	| 'held'
	| 'sending'
	| 'arriving'
	| 'sent'
	| 'failed'
	| 'nothing_due';

export const helperTransferChip = (
	status: HelperTransferStatus
): { label: string; status: MoneyChip } => {
	switch (status) {
		case 'scheduled':
			return { label: m.transfers_status_scheduled(), status: 'proposed' };
		case 'held':
			return { label: m.transfers_status_held(), status: 'in-progress' };
		case 'sending':
			return { label: m.transfers_status_sending(), status: 'in-progress' };
		case 'arriving':
			return { label: m.transfers_status_arriving(), status: 'in-progress' };
		case 'sent':
			return { label: m.transfers_status_sent(), status: 'approved' };
		case 'failed':
			return { label: m.transfers_status_failed(), status: 'rejected' };
		case 'nothing_due':
			return { label: m.transfers_status_nothing_due(), status: 'empty' };
	}
};

/** The toast for a refused or failed admin money action. */
export const adminMoneyErrorMessage = (error: AdminMoneyError): string => {
	switch (error.code) {
		case 'MONEY_ITEM_NOT_FOUND':
			return m.admin_money_error_not_found();
		case 'TRANSFER_NOT_PAYABLE':
			return m.admin_money_error_not_payable();
		case 'MANUAL_PAYOUT_AMOUNT_MISMATCH':
			return m.admin_money_error_amount_mismatch();
		case 'MANUAL_PAYOUT_ALREADY_RECORDED':
			return m.admin_money_error_already_recorded();
		case 'MANUAL_PAYOUT_ALREADY_DECIDED':
			return m.admin_money_error_already_decided();
		case 'MANUAL_PAYOUT_SECOND_ADMIN':
			return m.admin_money_error_second_admin();
		case 'MONEY_ITEM_NOT_FAILED':
			return m.admin_money_error_not_failed();
		case 'INVALID_MANUAL_PAYOUT':
		case 'INVALID_MANUAL_PAYOUT_DECISION':
		case 'INVALID_REFUND_HANDLED':
			return m.admin_money_error_invalid();
		case 'FORBIDDEN':
			return m.admin_money_error_forbidden();
		case 'UNEXPECTED':
			return error.status === null ? m.common_error_network() : m.common_error_generic();
		default:
			return m.admin_money_error_generic();
	}
};
