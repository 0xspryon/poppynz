import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	accountantErrorText,
	causeLabel,
	matchKindLabel,
	reconciliationCsvUrl,
	reimbursementStatusLabel,
	reimbursementStatusTone,
	reimbursementTypeLabel,
	reimbursementsCsvUrl,
	REIMBURSEMENT_STATUSES,
	REIMBURSEMENT_TYPES,
	reportCsvUrl
} from './accountant';

describe('the books’ words (Tier 3 step 5)', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it('labels every type and status in English and French, never the raw code', () => {
		for (const locale of ['en', 'fr'] as const) {
			overwriteGetLocale(() => locale);
			for (const type of REIMBURSEMENT_TYPES) expect(reimbursementTypeLabel(type)).not.toBe(type);
			for (const status of REIMBURSEMENT_STATUSES) {
				expect(reimbursementStatusLabel(status)).not.toBe(status);
			}
		}
		overwriteGetLocale(() => 'en');
		expect(reimbursementStatusLabel('handled')).toBe('Handled outside Stripe');
		overwriteGetLocale(() => 'fr');
		expect(reimbursementStatusLabel('handled')).toBe('Réglé hors de Stripe');
		expect(causeLabel('card_dispute')).toBe('Contestation bancaire perdue');
		expect(matchKindLabel('stripe_fee')).toBe('Frais Stripe');
	});

	it('tones settled items green, open ones in progress, reconciled ones complete', () => {
		expect(reimbursementStatusTone('paid')).toBe('approved');
		expect(reimbursementStatusTone('failed')).toBe('rejected');
		expect(reimbursementStatusTone('held')).toBe('in-progress');
		expect(reimbursementStatusTone('reconciled')).toBe('complete');
	});

	it('builds the CSV links with the filters applied, leaving empty ones out', () => {
		expect(reimbursementsCsvUrl({ type: 'family_refund', status: '', party: 'Hana' })).toMatch(
			/\/accountant\/reimbursements\.csv\?type=family_refund&party=Hana$/
		);
		expect(reportCsvUrl('fees', '2026-11-01', '2026-11-30')).toMatch(
			/\/accountant\/reports\/fees\.csv\?from=2026-11-01&to=2026-11-30$/
		);
		expect(reconciliationCsvUrl('2026-11-01', '2026-11-30', 'all')).toMatch(
			/\/accountant\/reconciliation\.csv\?from=2026-11-01&to=2026-11-30&view=all$/
		);
	});

	it('turns refusals into sentences', () => {
		overwriteGetLocale(() => 'en');
		expect(accountantErrorText({ code: 'RECONCILIATION_BUSY' })).toBe(
			'A reconciliation is already running. Try again in a few minutes.'
		);
		expect(accountantErrorText({ code: 'REIMBURSEMENT_NOT_SETTLED' })).toBe(
			'Only a settled item can be marked reconciled.'
		);
		overwriteGetLocale(() => 'fr');
		expect(accountantErrorText({ code: 'ACCOUNTANT_WRITE_IMPERSONATED' })).toMatch(/usurpation/);
	});
});
