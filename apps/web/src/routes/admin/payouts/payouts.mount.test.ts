// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
	listPayoutQueue,
	recordManualPayout,
	decideManualPayout,
	retryTransfer,
	toastSuccess,
	toastError
} = vi.hoisted(() => ({
	listPayoutQueue: vi.fn(),
	recordManualPayout: vi.fn(),
	decideManualPayout: vi.fn(),
	retryTransfer: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/admin-money', () => ({
	listPayoutQueue,
	recordManualPayout,
	decideManualPayout,
	retryTransfer
}));
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import PayoutsQueuePage from './+page.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const click = (selector: string) => {
	document.querySelector<HTMLButtonElement>(selector)?.click();
	flushSync();
};
const dialogButton = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
		(button) => button.textContent?.trim() === label
	);
const setValue = (selector: string, value: string) => {
	const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
	field.value = value;
	field.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

const item = (overrides: Record<string, unknown> = {}) => ({
	id: 'transfer-1',
	contractId: 'contract-1',
	helperUserId: 'helper-1',
	helperName: 'Maria Tester',
	cycleStartsOn: '2026-11-02',
	cycleEndsOn: '2026-11-04',
	sequence: 1,
	status: 'manual_review',
	amountCents: 12500,
	dueAt: '2026-11-06T13:00:00.000Z',
	failureReason: null,
	manualPayouts: [],
	...overrides
});
const pending = {
	id: 'manual-1',
	status: 'pending_approval',
	method: 'interac_etransfer',
	reference: 'ET-123',
	amountCents: 12500,
	reason: 'Stripe account closed',
	recordedByUserId: 'admin-1',
	recordedAt: '2026-11-07T10:00:00.000Z',
	decidedByUserId: null,
	decidedAt: null,
	decisionNote: null
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('admin manual payout queue', () => {
	it('records a manual payout with the amount prefilled, then toasts', async () => {
		listPayoutQueue.mockResolvedValue({ ok: true, data: { transfers: [item()] } });
		recordManualPayout.mockResolvedValue({ ok: true, data: { manualPayout: { id: 'manual-1' } } });
		const app = mount(PayoutsQueuePage, { target: document.body });
		await settle();
		const listed = text();
		click('[data-testid="manual-payout-open"]');
		const prefilled = document.querySelector<HTMLInputElement>('input[name="amount"]')?.value;
		setValue('input[name="reference"]', 'ET-123');
		setValue('textarea[name="reason"]', 'Stripe account closed');
		document
			.querySelector<HTMLFormElement>('[data-testid="manual-payout-form"]')
			?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await settle();
		unmount(app);

		expect(listed).toContain('Maria Tester');
		expect(listed).toContain('Needs review');
		expect(listed).toContain('$125.00');
		expect(prefilled).toBe('125.00');
		expect(recordManualPayout).toHaveBeenCalledWith('transfer-1', {
			method: 'interac_etransfer',
			reference: 'ET-123',
			amountCents: 12500,
			reason: 'Stripe account closed'
		});
		expect(toastSuccess).toHaveBeenCalledWith(
			'Manual payout recorded. Another admin must approve it.'
		);
		expect(listPayoutQueue).toHaveBeenCalledTimes(2);
	});

	it('toasts the API’s refusal when the amount does not match', async () => {
		listPayoutQueue.mockResolvedValue({ ok: true, data: { transfers: [item()] } });
		recordManualPayout.mockResolvedValue({
			ok: false,
			error: { code: 'MANUAL_PAYOUT_AMOUNT_MISMATCH', message: 'x' }
		});
		const app = mount(PayoutsQueuePage, { target: document.body });
		await settle();
		click('[data-testid="manual-payout-open"]');
		setValue('input[name="reference"]', 'ET-123');
		setValue('input[name="amount"]', '100');
		setValue('textarea[name="reason"]', 'Closed');
		document
			.querySelector<HTMLFormElement>('[data-testid="manual-payout-form"]')
			?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await settle();
		unmount(app);

		expect(recordManualPayout).toHaveBeenCalledWith(
			'transfer-1',
			expect.objectContaining({ amountCents: 10000 })
		);
		expect(toastError).toHaveBeenCalledWith('The amount must be exactly the transfer’s amount.');
	});

	it('approves a pending manual payout, and says when the recorder tries to', async () => {
		listPayoutQueue.mockResolvedValue({
			ok: true,
			data: { transfers: [item({ manualPayouts: [pending] })] }
		});
		decideManualPayout.mockResolvedValueOnce({ ok: true, data: {} }).mockResolvedValueOnce({
			ok: false,
			error: { code: 'MANUAL_PAYOUT_SECOND_ADMIN', message: 'x' }
		});
		const app = mount(PayoutsQueuePage, { target: document.body });
		await settle();
		const listed = text();
		const canRecord = document.querySelector('[data-testid="manual-payout-open"]');
		click('[data-testid="manual-payout-approve"]');
		dialogButton('Approve')?.click();
		await settle();
		click('[data-testid="manual-payout-approve"]');
		dialogButton('Approve')?.click();
		await settle();
		unmount(app);

		expect(listed).toContain('Interac e-Transfer · ET-123 · $125.00');
		expect(listed).toContain('Awaiting approval');
		expect(canRecord).toBeNull();
		expect(decideManualPayout).toHaveBeenCalledWith('manual-1', {
			decision: 'approved',
			note: null
		});
		expect(toastSuccess).toHaveBeenCalledWith('Manual payout approved.');
		expect(toastError).toHaveBeenCalledWith('Another admin must approve the payout you recorded.');
	});

	it('needs a note to reject', async () => {
		listPayoutQueue.mockResolvedValue({
			ok: true,
			data: { transfers: [item({ manualPayouts: [pending] })] }
		});
		decideManualPayout.mockResolvedValue({ ok: true, data: {} });
		const app = mount(PayoutsQueuePage, { target: document.body });
		await settle();
		click('[data-testid="manual-payout-reject"]');
		dialogButton('Reject')?.click();
		await settle();
		const calledWithoutNote = decideManualPayout.mock.calls.length;
		setValue('[data-testid="manual-payout-note"]', 'Wrong reference');
		dialogButton('Reject')?.click();
		await settle();
		unmount(app);

		expect(calledWithoutNote).toBe(0);
		expect(toastError).toHaveBeenCalledWith('Add a note first.');
		expect(decideManualPayout).toHaveBeenCalledWith('manual-1', {
			decision: 'rejected',
			note: 'Wrong reference'
		});
		expect(toastSuccess).toHaveBeenCalledWith('Manual payout rejected.');
	});

	it('retries a refused transfer', async () => {
		listPayoutQueue.mockResolvedValue({
			ok: true,
			data: { transfers: [item({ status: 'failed', failureReason: 'account_closed' })] }
		});
		retryTransfer.mockResolvedValue({ ok: true, data: {} });
		const app = mount(PayoutsQueuePage, { target: document.body });
		await settle();
		const listed = text();
		click('[data-testid="transfer-retry"]');
		await settle();
		unmount(app);

		expect(listed).toContain('Refused');
		expect(listed).toContain('Reason: account_closed');
		expect(retryTransfer).toHaveBeenCalledWith('transfer-1');
		expect(toastSuccess).toHaveBeenCalledWith('Transfer sent to Stripe again.');
	});
});
