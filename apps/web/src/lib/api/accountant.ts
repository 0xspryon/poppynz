/** The accountant's books (Tier 3 step 5), backed by /accountant: the
 * reimbursements ledger, the money reports and the reconciliation with
 * Stripe. Access follows the `reimbursements` and `reconciliation`
 * permissions (the accountant and admins), never the role. */
import { API_BASE_PATH } from 'api/hc';
import { formatMoney } from '$lib/money';
import { m } from '$lib/paraglide/messages';
import { apiClient, call, type ErrorsOf } from './client';

const accessEndpoint = apiClient.accountant.access.$get;
const listEndpoint = apiClient.accountant.reimbursements.$get;
const itemEndpoint = apiClient.accountant.reimbursements[':key'].$get;
const noteEndpoint = apiClient.accountant.reimbursements[':key'].notes.$post;
const reconcileEndpoint = apiClient.accountant.reimbursements[':key'].reconcile.$post;
const reportEndpoint = apiClient.accountant.reports[':report'].$get;
const reconciliationEndpoint = apiClient.accountant.reconciliation.$get;
const runEndpoint = apiClient.accountant.reconciliation.runs.$post;
const resolveEndpoint = apiClient.accountant.reconciliation.items[':key'].resolve.$post;

type Ok<T> = Extract<Awaited<T>, { ok: true }> extends { data: infer D } ? D : never;

/** The RPC input types omit `json` (and the param route's `query`) — the
 * client still sends them at runtime. */
const args = <E extends (...input: never[]) => unknown>(_endpoint: E, value: unknown) =>
	value as Parameters<E>[0];

export type AccountantAccess = Ok<ReturnType<typeof getAccountantAccess>>;
export type ReimbursementList = Ok<ReturnType<typeof listReimbursements>>;
export type Reimbursement = ReimbursementList['items'][number];
export type ReimbursementTotals = ReimbursementList['totals'];
export type ReimbursementDetail = Ok<ReturnType<typeof getReimbursement>>;
export type ReconciliationView = Ok<ReturnType<typeof getReconciliation>>;
export type ReconciliationRow = ReconciliationView['items'][number];
export type ReconciliationRun = ReconciliationView['runs'][number];
export type AccountantError =
	| ErrorsOf<typeof listEndpoint>
	| ErrorsOf<typeof itemEndpoint>
	| ErrorsOf<typeof noteEndpoint>
	| ErrorsOf<typeof reconcileEndpoint>
	| ErrorsOf<typeof reportEndpoint>
	| ErrorsOf<typeof reconciliationEndpoint>
	| ErrorsOf<typeof runEndpoint>
	| ErrorsOf<typeof resolveEndpoint>
	| ErrorsOf<typeof accessEndpoint>;

export type ReimbursementType = Reimbursement['type'];
export type ReimbursementStatus = Reimbursement['status'];
export type ReportKind = 'liabilities' | 'refunds' | 'absorbed' | 'fees';

export const REIMBURSEMENT_TYPES: ReadonlyArray<ReimbursementType> = [
	'family_refund',
	'poppynz_helper_pay',
	'absorbed',
	'manual_payout',
	'helper_recovery',
	'unpaid_extra_session',
	'held_helper_pay'
];
export const REIMBURSEMENT_STATUSES: ReadonlyArray<ReimbursementStatus> = [
	'pending',
	'failed',
	'paid',
	'handled',
	'outstanding',
	'recovered',
	'absorbed',
	'recorded',
	'approved',
	'rejected',
	'repaid',
	'waived',
	'unpaid',
	'held',
	'reconciled'
];

export type ReimbursementFilter = {
	type?: string;
	status?: string;
	from?: string;
	to?: string;
	party?: string;
	contract?: string;
};

const clean = (query: Record<string, string | undefined>) =>
	Object.fromEntries(
		Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
	);

export async function getAccountantAccess() {
	return call(accessEndpoint());
}

export async function listReimbursements(filter: ReimbursementFilter) {
	return call(listEndpoint({ query: clean(filter) }));
}

export async function getReimbursement(key: string) {
	return call(itemEndpoint({ param: { key } }));
}

export async function addReimbursementNote(key: string, note: string) {
	return call(noteEndpoint(args(noteEndpoint, { param: { key }, json: { note } })));
}

export async function reconcileReimbursement(key: string, reconciled: boolean, note?: string) {
	return call(
		reconcileEndpoint(
			args(reconcileEndpoint, { param: { key }, json: { reconciled, note: note ?? null } })
		)
	);
}

export async function getAccountantReport(report: ReportKind, from: string, to: string) {
	return call(reportEndpoint(args(reportEndpoint, { param: { report }, query: { from, to } })));
}

export async function getReconciliation(from: string, to: string, view: 'exceptions' | 'all') {
	return call(reconciliationEndpoint({ query: { from, to, view } }));
}

export async function runReconciliation(from: string, to: string) {
	return call(runEndpoint(args(runEndpoint, { json: { from, to } })));
}

export async function resolveReconciliationItem(key: string, note: string, resolved = true) {
	return call(resolveEndpoint(args(resolveEndpoint, { param: { key }, json: { note, resolved } })));
}

/** CSV downloads, fetched by the browser with the session cookie. */
export const reimbursementsCsvUrl = (filter: ReimbursementFilter) =>
	`${API_BASE_PATH}/accountant/reimbursements.csv?${new URLSearchParams(clean(filter)).toString()}`;
export const reportCsvUrl = (report: ReportKind, from: string, to: string) =>
	`${API_BASE_PATH}/accountant/reports/${report}.csv?${new URLSearchParams({ from, to }).toString()}`;
export const reconciliationCsvUrl = (from: string, to: string, view: 'exceptions' | 'all') =>
	`${API_BASE_PATH}/accountant/reconciliation.csv?${new URLSearchParams({ from, to, view }).toString()}`;

// ---------------------------------------------------------------------------
// Words

export const reimbursementTypeLabel = (type: string): string => {
	switch (type) {
		case 'family_refund':
			return m.books_type_family_refund();
		case 'poppynz_helper_pay':
			return m.books_type_poppynz_helper_pay();
		case 'absorbed':
			return m.books_type_absorbed();
		case 'manual_payout':
			return m.books_type_manual_payout();
		case 'helper_recovery':
			return m.books_type_helper_recovery();
		case 'unpaid_extra_session':
			return m.books_type_unpaid_extra_session();
		case 'held_helper_pay':
			return m.books_type_held_helper_pay();
		default:
			return type;
	}
};

export const reimbursementStatusLabel = (status: string): string => {
	switch (status) {
		case 'pending':
			return m.books_status_pending();
		case 'failed':
			return m.books_status_failed();
		case 'paid':
			return m.books_status_paid();
		case 'handled':
			return m.books_status_handled();
		case 'outstanding':
			return m.books_status_outstanding();
		case 'recovered':
			return m.books_status_recovered();
		case 'absorbed':
			return m.books_status_absorbed();
		case 'recorded':
			return m.books_status_recorded();
		case 'approved':
			return m.books_status_approved();
		case 'rejected':
			return m.books_status_rejected();
		case 'repaid':
			return m.books_status_repaid();
		case 'waived':
			return m.books_status_waived();
		case 'unpaid':
			return m.books_status_unpaid();
		case 'held':
			return m.books_status_held();
		case 'reconciled':
			return m.books_status_reconciled();
		default:
			return status;
	}
};

/** The StatusChip tone of a status (a subset of ChipStatus). */
export const reimbursementStatusTone = (
	status: string
): 'approved' | 'complete' | 'rejected' | 'empty' | 'in-progress' | 'proposed' => {
	switch (status) {
		case 'reconciled':
			return 'complete';
		case 'paid':
		case 'handled':
		case 'recovered':
		case 'approved':
		case 'repaid':
			return 'approved';
		case 'failed':
		case 'rejected':
		case 'unpaid':
			return 'rejected';
		case 'absorbed':
		case 'waived':
			return 'empty';
		case 'recorded':
			return 'proposed';
		default:
			return 'in-progress';
	}
};

export const directionLabel = (direction: string): string => {
	switch (direction) {
		case 'payable':
			return m.books_direction_payable();
		case 'receivable':
			return m.books_direction_receivable();
		case 'cost':
			return m.books_direction_cost();
		default:
			return direction;
	}
};

export const causeLabel = (cause: string | null): string | null => {
	switch (cause) {
		case null:
			return null;
		case 'carry_write_off':
			return m.books_cause_carry_write_off();
		case 'resume_absorbed':
			return m.books_cause_resume_absorbed();
		case 'over_refund':
			return m.books_cause_over_refund();
		case 'card_dispute':
			return m.books_cause_card_dispute();
		case 'card_dispute_fee':
			return m.books_cause_card_dispute_fee();
		case 'system_failure':
			return m.books_cause_system_failure();
		case 'recovery_waived':
			return m.books_cause_recovery_waived();
		default:
			return cause;
	}
};

export const eventActionLabel = (action: string): string => {
	switch (action) {
		case 'note':
			return m.books_event_note();
		case 'reconciled':
			return m.books_event_reconciled();
		case 'unreconciled':
			return m.books_event_unreconciled();
		case 'handled':
			return m.books_event_handled();
		case 'retried':
			return m.books_event_retried();
		case 'recorded':
			return m.books_event_recorded();
		case 'approved':
			return m.books_event_approved();
		case 'rejected':
			return m.books_event_rejected();
		default:
			return action;
	}
};

export const matchKindLabel = (kind: string | null): string => {
	switch (kind) {
		case 'payment':
			return m.books_match_payment();
		case 'payment_refund':
			return m.books_match_payment_refund();
		case 'session_refund':
			return m.books_match_session_refund();
		case 'helper_transfer':
			return m.books_match_helper_transfer();
		case 'transfer_arrival':
			return m.books_match_transfer_arrival();
		case 'platform_payout':
			return m.books_match_platform_payout();
		case 'helper_payout':
			return m.books_match_helper_payout();
		case 'stripe_fee':
			return m.books_match_stripe_fee();
		case 'card_dispute':
			return m.books_match_card_dispute();
		default:
			return kind ?? '—';
	}
};

export const reconciliationStatusLabel = (status: string): string => {
	switch (status) {
		case 'matched':
			return m.books_recon_status_matched();
		case 'unmatched':
			return m.books_recon_status_unmatched();
		case 'mismatch':
			return m.books_recon_status_mismatch();
		case 'resolved':
			return m.books_recon_status_resolved();
		default:
			return status;
	}
};

export const runStatusLabel = (status: string): string => {
	switch (status) {
		case 'running':
			return m.books_recon_run_status_running();
		case 'succeeded':
			return m.books_recon_run_status_succeeded();
		case 'incomplete':
			return m.books_recon_run_status_incomplete();
		case 'failed':
			return m.books_recon_run_status_failed();
		default:
			return status;
	}
};

export const reportLabel = (report: ReportKind): string => {
	switch (report) {
		case 'liabilities':
			return m.books_report_liabilities();
		case 'refunds':
			return m.books_report_refunds();
		case 'absorbed':
			return m.books_report_absorbed();
		case 'fees':
			return m.books_report_fees();
	}
};

/** The server's matching note (written in English, stored with the
 * transaction) in the reader's language; an unknown one as it is. */
export const reconciliationNoteText = (note: string | null): string => {
	if (note === null) return '';
	switch (note) {
		case 'no payment of ours for this charge':
			return m.books_recon_note_no_payment();
		case 'no refund of ours for this refund':
			return m.books_recon_note_no_refund();
		case 'no helper transfer of ours for this transfer':
			return m.books_recon_note_no_transfer();
		case 'no card dispute on file for this dispute':
			return m.books_recon_note_no_dispute();
		case 'not found in the provider’s balance transactions for the period':
			return m.books_recon_note_not_at_provider();
	}
	const amounts = /^amount (-?\d+) at the provider, (-?\d+) on our side$/.exec(note);
	if (amounts) {
		return m.books_recon_note_amounts({
			provider: formatMoney(Number(amounts[1])),
			ours: formatMoney(Number(amounts[2]))
		});
	}
	const unknown = /^unrecognised (\S+) (transaction|on a helper's account)$/.exec(note);
	if (unknown) return m.books_recon_note_unrecognised({ type: unknown[1]! });
	return note;
};

/** A run's recorded error in the reader's language (the provider's own
 * message is kept after it). */
export const reconciliationRunErrorText = (error: string | null): string => {
	if (error === null) return '';
	if (error === 'abandoned (still running)') return m.books_recon_error_abandoned();
	if (error === 'database error') return m.books_recon_error_database();
	const pages = /^stopped after (\d+) pages$/.exec(error);
	if (pages) return m.books_recon_error_pages({ pages: pages[1]! });
	if (error.startsWith('provider: ')) {
		return m.books_recon_error_provider({ detail: error.slice('provider: '.length) });
	}
	return error;
};

/** The toast for a refused or failed request. */
export const accountantErrorText = (error: { code: string; status?: number | null }): string => {
	switch (error.code) {
		case 'FORBIDDEN':
		case 'UNAUTHORIZED':
			return m.books_error_forbidden();
		case 'ACCOUNTANT_WRITE_IMPERSONATED':
			return m.books_error_impersonated();
		case 'REIMBURSEMENT_NOT_FOUND':
		case 'RECONCILIATION_ITEM_NOT_FOUND':
			return m.books_error_not_found();
		case 'REIMBURSEMENT_NOT_SETTLED':
			return m.books_error_not_settled();
		case 'RECONCILIATION_ITEM_MATCHED':
			return m.books_error_matched();
		case 'ACCOUNTANT_RANGE_INVALID':
			return m.books_error_range();
		case 'RECONCILIATION_BUSY':
			return m.books_error_busy();
		case 'RECONCILIATION_PERIOD_IN_FUTURE':
			return m.books_error_future();
		case 'INVALID_REIMBURSEMENT_QUERY':
		case 'INVALID_ITEM_KEY':
		case 'INVALID_REIMBURSEMENT_NOTE':
		case 'INVALID_RECONCILE_INPUT':
		case 'INVALID_ACCOUNTANT_REPORT_QUERY':
		case 'INVALID_RECONCILIATION_PERIOD':
		case 'INVALID_RECONCILIATION_RUN':
		case 'INVALID_RECONCILIATION_RESOLUTION':
			return m.books_error_invalid();
		case 'UNEXPECTED':
			return error.status === null ? m.common_error_network() : m.books_error_generic();
		default:
			return m.books_error_generic();
	}
};
