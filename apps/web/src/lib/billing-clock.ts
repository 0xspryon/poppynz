/** Staging UAT — the admin billing fast-forward's labels and messages. */
import type { BillingClockError } from '$lib/api/billing-clock';
import { formatDate, formatDateTime, formatDateTimeIn } from '$lib/date';
import { m } from '$lib/paraglide/messages';

type EventLike = { kind: string; cycleNumber: number | null; date: string | null };

/** "Cycle 2: capture", "Extra session on 9 Nov 2026: charge"… */
export const billingClockEventLabel = (event: EventLike): string => {
	const number = String(event.cycleNumber ?? '');
	const date = event.date ? formatDate(event.date) : '';
	switch (event.kind) {
		case 'cycle_hold':
			return m.admin_billing_clock_event_cycle_hold({ number });
		case 'cycle_hold_retry':
			return m.admin_billing_clock_event_cycle_hold_retry({ number });
		case 'cycle_starts_suspended':
			return m.admin_billing_clock_event_cycle_starts_suspended({ number });
		case 'readiness_cancellation':
			return m.admin_billing_clock_event_readiness_cancellation();
		case 'cycle_suspension':
			return m.admin_billing_clock_event_cycle_suspension({ number });
		case 'cycle_capture':
			return m.admin_billing_clock_event_cycle_capture({ number });
		case 'cycle_capture_retry':
			return m.admin_billing_clock_event_cycle_capture_retry({ number });
		case 'cycle_transfer':
			return m.admin_billing_clock_event_cycle_transfer({ number });
		case 'transfer_due':
			return m.admin_billing_clock_event_transfer_due();
		case 'resolution_deadline':
			return m.admin_billing_clock_event_resolution_deadline();
		case 'day_off_cutoff':
			return m.admin_billing_clock_event_day_off_cutoff();
		case 'extra_response_deadline':
			return m.admin_billing_clock_event_extra_response_deadline({ date });
		case 'extra_charge':
			return m.admin_billing_clock_event_extra_charge({ date });
		case 'extra_charge_retry':
			return m.admin_billing_clock_event_extra_charge_retry({ date });
		case 'dispute_evidence_reminder':
			return m.admin_billing_clock_event_dispute_evidence_reminder();
		default:
			return m.admin_billing_clock_run_custom();
	}
};

/** A run's event, named in the reader's language from what the API stored
 * (its kind, cycle number and date); a run up to an instant matching no
 * event reads "Chosen instant". */
export const billingClockRunLabel = (run: {
	eventKind: string | null;
	eventCycleNumber: number | null;
	eventDate: string | null;
}): string =>
	run.eventKind === null
		? m.admin_billing_clock_run_custom()
		: billingClockEventLabel({
				kind: run.eventKind,
				cycleNumber: run.eventCycleNumber,
				date: run.eventDate
			});

/** An instant in the contract's time zone ("2 Nov 2026 at 7:00 a.m."), as
 * the billing engine reads it; the browser's zone when the contract's is
 * unknown. */
export const billingClockInstant = (value: string, timeZone: string | null | undefined) => {
	if (!timeZone) return formatDateTime(value);
	try {
		return formatDateTimeIn(value, timeZone);
	} catch {
		return formatDateTime(value);
	}
};

/** The contract's billing status, as admins read it. */
export const billingStatusLabel = (status: string | null): string => {
	switch (status) {
		case 'awaiting_payment_readiness':
			return m.admin_billing_clock_billing_awaiting_payment_readiness();
		case 'scheduled':
			return m.admin_billing_clock_billing_scheduled();
		case 'active':
			return m.admin_billing_clock_billing_active();
		case 'suspended':
			return m.admin_billing_clock_billing_suspended();
		case 'cancelled':
			return m.admin_billing_clock_billing_cancelled();
		case 'ended':
			return m.admin_billing_clock_billing_ended();
		default:
			return status ?? '—';
	}
};

// Literals (`as const`) so they type-check as StatusChip's ChipStatus.
export const billingStatusChip = (status: string) => {
	const label = billingStatusLabel(status);
	switch (status) {
		case 'active':
			return { status: 'active' as const, label };
		case 'suspended':
			return { status: 'suspended' as const, label };
		case 'cancelled':
		case 'ended':
			return { status: 'ended' as const, label };
		case 'awaiting_payment_readiness':
			return { status: 'missing' as const, label };
		default:
			return { status: 'proposed' as const, label };
	}
};

export const runChip = (status: string) => {
	switch (status) {
		case 'succeeded':
			return { status: 'approved' as const, label: m.admin_billing_clock_run_succeeded() };
		case 'failed':
			return { status: 'rejected' as const, label: m.admin_billing_clock_run_failed() };
		default:
			return { status: 'in-progress' as const, label: m.admin_billing_clock_run_running() };
	}
};

export const billingClockErrorMessage = (error: BillingClockError): string => {
	switch (error.code) {
		case 'BILLING_CLOCK_CONTRACT_NOT_FOUND':
			return m.admin_billing_clock_error_not_found();
		case 'BILLING_CLOCK_NOT_IN_FUTURE':
			return m.admin_billing_clock_error_not_in_future();
		case 'BILLING_CLOCK_TOO_FAR':
			return m.admin_billing_clock_error_too_far();
		case 'BILLING_CLOCK_ALREADY_RUNNING':
			return m.admin_billing_clock_error_already_running();
		case 'NOT_FOUND':
			return m.admin_billing_clock_error_disabled();
		default:
			return m.admin_billing_clock_error_generic();
	}
};
