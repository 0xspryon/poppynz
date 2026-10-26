import type { ChipStatus } from '$lib/components/StatusChip.svelte';
import { m } from '$lib/paraglide/messages';

/** A billing cycle's status chip, worded for the viewer's side — shared by
 * the contract's Billing panel and the cycle page (UAT round 2 #11a). */
export const cycleChip = (
	status: string,
	isFamily: boolean
): { status: ChipStatus; label: string } => {
	switch (status) {
		case 'scheduled':
			return { status: 'empty', label: m.contracts_cycle_upcoming() };
		case 'authorising':
		case 'capturing':
			return { status: 'in-progress', label: m.contracts_cycle_processing() };
		case 'authorised':
			return {
				status: 'in-progress',
				label: isFamily ? m.contracts_cycle_on_hold() : m.contracts_cycle_funds_on_hold()
			};
		case 'grace':
			return {
				status: 'missing',
				label: isFamily ? m.contracts_cycle_card_declined() : m.contracts_cycle_payment_pending()
			};
		case 'captured':
			return {
				status: 'approved',
				label: isFamily ? m.contracts_cycle_paid() : m.contracts_cycle_funded()
			};
		case 'suspended':
			return { status: 'rejected', label: m.contracts_cycle_suspended() };
		case 'capture_failed':
			return {
				status: 'missing',
				label: isFamily ? m.contracts_cycle_payment_issue() : m.contracts_cycle_funded_by_poppynz()
			};
		case 'cancelled':
			return { status: 'expired', label: m.contracts_cycle_cancelled() };
		case 'carried':
			return { status: 'empty', label: m.contracts_cycle_carried() };
		case 'empty':
		default:
			return { status: 'empty', label: m.contracts_cycle_empty() };
	}
};

/** A dated session's status chip on the cycle page. */
export const sessionChip = (status: string): { status: ChipStatus; label: string } => {
	switch (status) {
		case 'completed':
			return { status: 'approved', label: m.contracts_session_status_completed() };
		case 'cancelled':
			return { status: 'expired', label: m.contracts_session_status_cancelled() };
		case 'disputed':
			return { status: 'missing', label: m.contracts_session_status_disputed() };
		case 'suspended':
			return { status: 'rejected', label: m.contracts_session_status_suspended() };
		case 'scheduled':
		default:
			return { status: 'empty', label: m.contracts_session_status_scheduled() };
	}
};
