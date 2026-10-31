/** Extra sessions (Tier 3 step 3): the words for each state and refusal,
 * the time fields' conversions, and the delay as people say it. Every amount
 * and setting comes from the API. */
import type {
	ExtraSession,
	ExtraSessionError,
	ExtraSessionProposeFacts
} from '$lib/api/extra-sessions';
import { formatSessionRange } from '$lib/contract-sessions';
import { formatDateTime, formatDateWithWeekday } from '$lib/date';
import { formatMoney } from '$lib/money';
import { m } from '$lib/paraglide/messages';

/** The StatusChip statuses an extra session reads in (a subset of
 * ChipStatus; plain tsc can't read a .svelte module's types). */
export type ExtraSessionChip =
	| 'proposed'
	| 'in-progress'
	| 'approved'
	| 'complete'
	| 'rejected'
	| 'empty';

export const extraSessionChip = (
	row: Pick<ExtraSession, 'status'>
): { status: ExtraSessionChip; label: string } => {
	switch (row.status) {
		case 'proposed':
			return { status: 'proposed', label: m.extra_sessions_chip_awaiting() };
		case 'agreed':
			return { status: 'in-progress', label: m.extra_sessions_chip_pending() };
		case 'in_cycle':
			return { status: 'approved', label: m.extra_sessions_chip_in_cycle() };
		case 'charging':
			return { status: 'in-progress', label: m.extra_sessions_chip_charging() };
		case 'charge_failed':
			return { status: 'rejected', label: m.extra_sessions_chip_failed() };
		case 'charged':
			return { status: 'complete', label: m.extra_sessions_chip_charged() };
		case 'cancelled':
			return { status: 'rejected', label: m.extra_sessions_chip_cancelled() };
		case 'withdrawn':
			return { status: 'rejected', label: m.extra_sessions_chip_withdrawn() };
		case 'declined':
			return { status: 'rejected', label: m.extra_sessions_chip_declined() };
		case 'lapsed':
			return { status: 'rejected', label: m.extra_sessions_chip_lapsed() };
	}
};

/** The state line's tone: green once the session is billed, red once it
 * failed or won't happen, neutral while it is still in progress. */
export const extraSessionTone = (
	row: Pick<ExtraSession, 'status'>
): 'success' | 'error' | 'neutral' => {
	switch (row.status) {
		case 'in_cycle':
		case 'charged':
			return 'success';
		case 'charge_failed':
		case 'cancelled':
		case 'withdrawn':
		case 'declined':
		case 'lapsed':
			return 'error';
		default:
			return 'neutral';
	}
};

/** "1 hour", "45 minutes" — the charge delay as people say it. */
export const delayText = (minutes: number): string =>
	minutes === 0
		? m.extra_sessions_delay_now()
		: minutes === 60
			? m.extra_sessions_delay_one_hour()
			: minutes % 60 === 0
				? m.extra_sessions_delay_hours({ hours: minutes / 60 })
				: m.extra_sessions_delay_minutes({ minutes });

/** "Childcare, Tue, Nov 3, 10:00 am – 12:00 pm". */
export const extraSessionLabel = (
	row: Pick<ExtraSession, 'serviceName' | 'date' | 'startMinutes' | 'endMinutes'>
) =>
	`${row.serviceName}, ${formatDateWithWeekday(row.date)}, ${formatSessionRange({
		weekday: 0,
		startMinutes: row.startMinutes,
		endMinutes: row.endMinutes
	})}`;

/** Where the extra session stands, in the viewer's words. */
/** A date and time inside a sentence: "4:21 p.m." loses its own full stop,
 * so a message that ends the sentence after it never reads "p.m..". */
export const sentenceDateTime = (value: string) => formatDateTime(value).replace(/\.$/, '');

export const extraSessionStateText = (
	row: ExtraSession,
	viewerSide: 'family' | 'helper',
	counterpartName: string
): string => {
	const amount = formatMoney(
		(viewerSide === 'family' ? row.familyTotalCents : row.helperShareCents) ?? 0
	);
	switch (row.status) {
		case 'proposed': {
			const deadline = sentenceDateTime(row.respondBy);
			if (row.proposedByMe) {
				return m.extra_sessions_state_awaiting_mine({ name: counterpartName, deadline });
			}
			return viewerSide === 'family'
				? m.extra_sessions_state_awaiting_theirs_family({ name: counterpartName, deadline })
				: m.extra_sessions_state_awaiting_theirs_helper({ name: counterpartName, deadline });
		}
		case 'agreed': {
			const time = row.chargeAt ? formatDateTime(row.chargeAt) : '';
			return viewerSide === 'family'
				? m.extra_sessions_state_pending_family({ amount, time })
				: m.extra_sessions_state_pending_helper({ time });
		}
		case 'in_cycle':
			return m.extra_sessions_state_in_cycle();
		case 'charging':
			return m.extra_sessions_state_charging();
		case 'charge_failed':
			return viewerSide === 'family'
				? m.extra_sessions_state_failed_family()
				: m.extra_sessions_state_failed_helper();
		case 'charged':
			return viewerSide === 'family'
				? m.extra_sessions_state_charged_family({ amount })
				: m.extra_sessions_state_charged_helper({ amount });
		case 'cancelled':
			return m.extra_sessions_state_cancelled();
		case 'withdrawn':
			return m.extra_sessions_state_withdrawn();
		case 'declined':
			return m.extra_sessions_state_declined();
		case 'lapsed':
			return m.extra_sessions_state_lapsed();
	}
};

/** Why proposing is closed right now (the API's reason), or null. */
export const proposeBlockedText = (refusal: ExtraSessionProposeFacts['refusal']): string | null => {
	switch (refusal) {
		case 'contract_not_active':
			return m.extra_sessions_blocked_contract();
		case 'billing_unavailable':
			return m.extra_sessions_blocked_billing();
		case 'beyond_window':
			return m.extra_sessions_blocked_window();
		default:
			return null;
	}
};

/** "10:30" → 630; "" → null. An end of "00:00" is midnight (1440). */
export const timeToMinutes = (value: string, end = false): number | null => {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	const total = hours * 60 + minutes;
	return end && total === 0 ? 24 * 60 : total;
};

/** 630 → "10:30"; 1440 → "00:00" (for a time input). */
export const minutesToTime = (minutes: number): string => {
	const within = minutes % (24 * 60);
	return `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
};

/** The toast for a refusal, in the viewer's language. */
export const extraSessionErrorMessage = (
	error: ExtraSessionError,
	options: { minMinutes?: number } = {}
): string => {
	switch (error.code) {
		case 'EXTRA_SESSION_CONTRACT_NOT_ACTIVE':
			return m.extra_sessions_error_contract_not_active();
		case 'EXTRA_SESSION_BILLING_UNAVAILABLE':
			return m.extra_sessions_error_billing_unavailable();
		case 'EXTRA_SESSION_UNKNOWN_SERVICE':
			return m.extra_sessions_error_unknown_service();
		case 'EXTRA_SESSION_INVALID_TIMES':
		case 'INVALID_EXTRA_SESSION':
			return m.extra_sessions_error_invalid_times({ minutes: options.minMinutes ?? 15 });
		case 'EXTRA_SESSION_TOO_FAR_BACK':
			return m.extra_sessions_error_too_far_back();
		case 'EXTRA_SESSION_BEYOND_WINDOW':
			return m.extra_sessions_error_beyond_window();
		case 'EXTRA_SESSION_OUTSIDE_CONTRACT':
			return m.extra_sessions_error_outside_contract();
		case 'EXTRA_SESSION_NO_CYCLE':
			return m.extra_sessions_error_no_cycle();
		case 'EXTRA_SESSION_OVERLAP':
			return m.extra_sessions_error_overlap();
		case 'EXTRA_SESSION_AUTHORISATION_REQUIRED':
			return m.extra_sessions_error_authorisation_required();
		case 'EXTRA_SESSION_AMOUNT_CHANGED':
			return m.extra_sessions_error_amount_changed();
		case 'EXTRA_SESSION_NOT_PRICED':
			return m.extra_sessions_error_not_priced();
		case 'EXTRA_SESSION_WRONG_SIDE':
			return m.extra_sessions_error_wrong_side();
		case 'EXTRA_SESSION_NOTHING_TO_ANSWER':
			return m.extra_sessions_error_nothing_to_answer();
		case 'EXTRA_SESSION_RESPONSE_WINDOW_CLOSED':
			return m.extra_sessions_error_response_window_closed();
		case 'EXTRA_SESSION_NOT_WITHDRAWABLE':
			return m.extra_sessions_error_not_withdrawable();
		case 'EXTRA_SESSION_NOT_CANCELLABLE':
			return m.extra_sessions_error_not_cancellable();
		case 'EXTRA_SESSION_NOT_FOUND':
			return m.extra_sessions_error_not_found();
		default:
			return m.extra_sessions_error_generic();
	}
};
