// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listFailedRefunds, retryRefund, markRefundHandled, toastSuccess, toastError } = vi.hoisted(
	() => ({
		listFailedRefunds: vi.fn(),
		retryRefund: vi.fn(),
		markRefundHandled: vi.fn(),
		toastSuccess: vi.fn(),
		toastError: vi.fn()
	})
);

vi.mock('$lib/api/admin-money', () => ({ listFailedRefunds, retryRefund, markRefundHandled }));
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import AccountantRefundsPage from '../../accountant/refunds/+page.svelte';
import RefundsQueuePage from './+page.svelte';

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

const refund = {
	id: 'refund-1',
	contractId: 'contract-1',
	totalCents: 5039,
	failureReason: 'charge_disputed',
	createdAt: '2026-11-03T12:00:00.000Z',
	sessionDate: '2026-11-03',
	serviceName: 'Childcare'
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('admin failed refunds', () => {
	it('lists failed refunds and retries one', async () => {
		listFailedRefunds.mockResolvedValue({ ok: true, data: { refunds: [refund] } });
		retryRefund.mockResolvedValue({
			ok: true,
			data: { refund: { id: 'refund-1', status: 'succeeded' } }
		});
		const app = mount(RefundsQueuePage, { target: document.body });
		await settle();
		const listed = text();
		click('[data-testid="refund-retry"]');
		await settle();
		unmount(app);

		expect(listed).toContain('$50.39');
		expect(listed).toContain('Childcare');
		expect(listed).toContain('Reason: charge_disputed');
		expect(retryRefund).toHaveBeenCalledWith('refund-1');
		expect(toastSuccess).toHaveBeenCalledWith('Refund sent to Stripe again.');
	});

	it('toasts an error when Stripe refuses the retried refund again', async () => {
		listFailedRefunds.mockResolvedValue({ ok: true, data: { refunds: [refund] } });
		retryRefund.mockResolvedValue({
			ok: true,
			data: { refund: { id: 'refund-1', status: 'failed' } }
		});
		const app = mount(RefundsQueuePage, { target: document.body });
		await settle();
		click('[data-testid="refund-retry"]');
		await settle();
		unmount(app);

		expect(toastSuccess).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledWith(
			'Stripe refused the refund again. Check the reason, or mark it handled once the family is refunded another way.'
		);
	});

	it('marks a refund handled with a note, and toasts a refusal', async () => {
		listFailedRefunds.mockResolvedValue({ ok: true, data: { refunds: [refund] } });
		markRefundHandled.mockResolvedValue({
			ok: false,
			error: { code: 'MONEY_ITEM_NOT_FAILED', message: 'x' }
		});
		const app = mount(RefundsQueuePage, { target: document.body });
		await settle();
		click('[data-testid="refund-handled"]');
		const note = document.querySelector<HTMLTextAreaElement>(
			'[data-testid="refund-handled-note"]'
		)!;
		note.value = 'Refunded by Interac e-Transfer';
		note.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		dialogButton('Mark handled')?.click();
		await settle();
		unmount(app);

		expect(markRefundHandled).toHaveBeenCalledWith('refund-1', 'Refunded by Interac e-Transfer');
		expect(toastError).toHaveBeenCalledWith('Only a failed item can be retried or handled.');
	});

	it('is in the accountant area too (the accountant holds refundQueue)', async () => {
		listFailedRefunds.mockResolvedValue({ ok: true, data: { refunds: [refund] } });
		const app = mount(AccountantRefundsPage, { target: document.body });
		await settle();
		const listed = text();
		unmount(app);

		expect(listed).toContain('$50.39');
		expect(listed).toContain('Reason: charge_disputed');
	});
});
