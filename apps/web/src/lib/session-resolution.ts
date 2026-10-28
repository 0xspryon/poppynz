/** Session resolutions (Tier 3): labels, the window explainer and the toast
 * for each refusal — shared by the cycle page, the contract page and the
 * admin dispute queue. Every number in the copy comes from the API. */
import type { SessionActionError } from '$lib/api/contracts';
import type { ChipStatus } from '$lib/components/StatusChip.svelte';
import { m } from '$lib/paraglide/messages';

export type ResolutionKind =
	| 'family_cancelled_early'
	| 'family_cancelled_late'
	| 'family_no_show'
	| 'family_reduced_hours'
	| 'helper_cancelled'
	| 'helper_no_show'
	| 'day_off_agreed'
	| 'disputed'
	| 'as_scheduled';

export const resolutionKindLabel = (kind: ResolutionKind): string => {
	switch (kind) {
		case 'family_cancelled_early':
			return m.sessions_kind_family_cancelled_early();
		case 'family_cancelled_late':
			return m.sessions_kind_family_cancelled_late();
		case 'family_no_show':
			return m.sessions_kind_family_no_show();
		case 'family_reduced_hours':
			return m.sessions_kind_family_reduced_hours();
		case 'helper_cancelled':
			return m.sessions_kind_helper_cancelled();
		case 'helper_no_show':
			return m.sessions_kind_helper_no_show();
		case 'day_off_agreed':
			return m.sessions_kind_day_off();
		case 'disputed':
			return m.sessions_kind_disputed();
		case 'as_scheduled':
			return m.sessions_kind_as_scheduled();
	}
};

export type ResolutionStatus =
	| 'proposed'
	| 'confirmed'
	| 'contested'
	| 'decided'
	| 'lapsed'
	| 'reversed';

/** The status as words, and the chip it reads in. `awaitingMe`: a
 * proposal the viewer must answer. */
export const resolutionStatusChip = (
	status: ResolutionStatus,
	awaitingMe = false
): { label: string; status: ChipStatus } => {
	switch (status) {
		case 'proposed':
			return awaitingMe
				? { label: m.sessions_status_awaiting_you(), status: 'awaiting-you' }
				: { label: m.sessions_status_proposed(), status: 'proposed' };
		case 'confirmed':
			return { label: m.sessions_status_confirmed(), status: 'active' };
		case 'contested':
			return { label: m.sessions_status_contested(), status: 'changes-requested' };
		case 'decided':
			return { label: m.sessions_status_decided(), status: 'complete' };
		case 'lapsed':
			return { label: m.sessions_status_lapsed(), status: 'expired' };
		case 'reversed':
			return { label: m.sessions_status_declined(), status: 'declined' };
	}
};

export type SessionReason =
	| 'illness'
	| 'family_emergency'
	| 'schedule_change'
	| 'holiday'
	| 'other';

export const sessionReasons: ReadonlyArray<SessionReason> = [
	'illness',
	'family_emergency',
	'schedule_change',
	'holiday',
	'other'
];

export const sessionReasonLabel = (reason: SessionReason): string => {
	switch (reason) {
		case 'illness':
			return m.sessions_reason_illness();
		case 'family_emergency':
			return m.sessions_reason_family_emergency();
		case 'schedule_change':
			return m.sessions_reason_schedule_change();
		case 'holiday':
			return m.sessions_reason_holiday();
		case 'other':
			return m.sessions_reason_other();
	}
};

/** "14 days" / "14 jours" and "24 hours" / "24 heures". */
const days = (count: number) => m.contracts_lead_days({ count });
export const noticeHoursText = (count: number) => m.contracts_lead_hours({ count });

/** The window explainer (spec §3): sessions appear N days ahead, come back
 * for dates further out, cancelling at least the cutoff before is free. */
export const sessionWindowParagraphs = (window: {
	windowDays: number;
	cancellationNoticeHours: number;
}) => [
	m.sessions_window_ahead({ days: days(window.windowDays) }),
	m.sessions_window_later(),
	m.sessions_window_free({ notice: noticeHoursText(window.cancellationNoticeHours) })
];

/** The toast for a refused or failed session action. */
export const sessionActionErrorMessage = (error: SessionActionError): string => {
	switch (error.code) {
		case 'SESSION_OUTSIDE_WINDOW':
			return m.sessions_error_outside_window();
		case 'SESSION_UNAVAILABLE':
			return m.sessions_error_unavailable();
		case 'SESSION_ALREADY_STARTED':
			return m.sessions_error_already_started();
		case 'SESSION_NOT_STARTED':
			return m.sessions_error_not_started();
		case 'SESSION_REPORT_WINDOW_CLOSED':
			return m.sessions_error_report_window_closed();
		case 'SESSION_DAY_OFF_TOO_LATE':
			return m.sessions_error_day_off_too_late();
		case 'SESSION_ALREADY_RESOLVED':
			return m.sessions_error_already_resolved();
		case 'SESSION_WRONG_SIDE':
			return m.sessions_error_wrong_side();
		case 'SESSION_NOTHING_TO_ANSWER':
			return m.sessions_error_nothing_to_answer();
		case 'SESSION_RESPONSE_WINDOW_CLOSED':
			return m.sessions_error_response_window_closed();
		case 'SESSION_NOT_DISPUTABLE':
			return m.sessions_error_not_disputable();
		case 'SESSION_INVALID_RESPONSE':
			return m.sessions_error_invalid_response();
		case 'SESSION_INVALID_MINUTES':
			return m.sessions_error_invalid_minutes();
		case 'SESSION_NOT_FOUND':
			return m.sessions_error_not_found();
		case 'FORBIDDEN':
			return m.sessions_error_forbidden();
		default:
			return m.sessions_error_generic();
	}
};
