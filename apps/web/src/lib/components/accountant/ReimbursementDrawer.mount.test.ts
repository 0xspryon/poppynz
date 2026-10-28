// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getReimbursement, addReimbursementNote, reconcileReimbursement } = vi.hoisted(() => ({
	getReimbursement: vi.fn(),
	addReimbursementNote: vi.fn(),
	reconcileReimbursement: vi.fn()
}));

vi.mock('$lib/api/accountant', async (original) => ({
	...(await original<typeof import('$lib/api/accountant')>()),
	getReimbursement,
	addReimbursementNote,
	reconcileReimbursement
}));

import ReimbursementDrawer from './ReimbursementDrawer.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const item = (overrides: Record<string, unknown> = {}) => ({
	key: 'family_refund:r-1',
	type: 'family_refund',
	id: 'r-1',
	direction: 'payable',
	status: 'paid',
	baseStatus: 'paid',
	amountCents: 5041,
	outstandingCents: 0,
	occurredAt: '2026-11-04T14:59:00.000Z',
	settledAt: '2026-11-04T15:00:00.000Z',
	contractId: 'contract-1',
	cycleId: 'cycle-1',
	cycleLabel: '1 (2026-11-05 – 2026-11-07)',
	sessionId: 'session-1',
	sessionDate: '2026-11-05',
	serviceName: 'Babysitting',
	paymentId: 'payment-1',
	paymentReference: 'pi_1',
	providerObject: { kind: 'refund', reference: 're_1' },
	familyName: 'Fiona Family',
	helperName: 'Hana Helper',
	cause: null,
	detail: null,
	reconciled: null,
	notes: 0,
	canReconcile: true,
	...overrides
});

const detail = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		item: item(overrides),
		notes: [],
		trail: {
			events: [
				{
					id: 'e1',
					entity: 'session_refund',
					action: 'handled',
					by: 'Alex Admin',
					note: 'ET-9',
					at: '2026-11-04T15:00:00.000Z'
				}
			],
			resolutions: [],
			ledger: [],
			transferItems: [
				{
					id: 'ti1',
					kind: 'session',
					amountCents: 4212,
					transferId: 't1',
					transferStatus: 'paid',
					transferReference: 'tr_1',
					payoutReference: 'po_1',
					payoutMatch: 'exact',
					at: '2026-11-07T05:00:00.000Z'
				}
			]
		}
	}
});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

const open = (props: { canNote: boolean; canReconcile: boolean }) =>
	mount(ReimbursementDrawer, {
		target: document.body,
		props: { itemKey: 'family_refund:r-1', ...props, onclose: vi.fn(), onchange: vi.fn() }
	});

describe('ReimbursementDrawer', () => {
	it('shows the item’s trail to its session, payment, Stripe object and payout', async () => {
		getReimbursement.mockResolvedValue(detail());
		const app = open({ canNote: false, canReconcile: false });
		await settle();
		const shown = text();
		const actions = document.querySelectorAll('[data-testid="reconcile-toggle"]').length;
		unmount(app);
		expect(shown).toContain('Family refund');
		expect(shown).toContain('Fiona Family');
		expect(shown).toContain('pi_1');
		expect(shown).toContain('re_1');
		expect(shown).toContain('Marked handled by Alex Admin: ET-9');
		expect(shown).toContain('Paid to the bank: payout po_1 (exact)');
		expect(actions).toBe(0);
	});

	it('marks a settled item reconciled with a note, by permission', async () => {
		getReimbursement.mockResolvedValue(detail());
		reconcileReimbursement.mockResolvedValue({
			ok: true,
			data: { item: item({ status: 'reconciled' }) }
		});
		const app = open({ canNote: true, canReconcile: true });
		await settle();
		const input = document.querySelector<HTMLInputElement>('[data-testid="reconcile-note"]')!;
		input.value = 'bank line 14';
		input.dispatchEvent(new Event('input'));
		document.querySelector<HTMLButtonElement>('[data-testid="reconcile-toggle"]')!.click();
		await settle();
		unmount(app);
		expect(reconcileReimbursement).toHaveBeenCalledWith('family_refund:r-1', true, 'bank line 14');
	});

	it('explains that an unsettled item can’t be reconciled yet', async () => {
		getReimbursement.mockResolvedValue(
			detail({ status: 'failed', baseStatus: 'failed', canReconcile: false })
		);
		const app = open({ canNote: true, canReconcile: true });
		await settle();
		const shown = text();
		unmount(app);
		expect(shown).toContain('It can be marked reconciled once it is settled.');
		expect(document.querySelector('[data-testid="reconcile-toggle"]')).toBeNull();
	});
});
