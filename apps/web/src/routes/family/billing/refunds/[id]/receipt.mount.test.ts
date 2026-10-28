// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getRefundReceipt } = vi.hoisted(() => ({ getRefundReceipt: vi.fn() }));

vi.mock('$lib/api/session-money', () => ({ getRefundReceipt }));
vi.mock('$app/state', () => ({ page: { params: { id: 'refund-1' } } }));

import ReceiptPage from './+page.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const receipt = {
	id: 'refund-1',
	number: 'CN-000042',
	status: 'succeeded',
	createdAt: '2026-11-03T12:00:00.000Z',
	refundedAt: '2026-11-03T12:05:00.000Z',
	careCents: 4200,
	feeCents: 210,
	taxCents: 629,
	totalCents: 5039,
	taxLines: [
		{ label: 'GST (MB) 5%', taxCents: 221, baseCents: 4410, registrationNumber: '123456789RT0001' },
		{ label: 'PST (MB) 7%', taxCents: 408, baseCents: 4200, registrationNumber: null }
	],
	session: { date: '2026-11-03', serviceName: 'Childcare', startMinutes: 930, endMinutes: 1050 },
	charge: {
		id: 'charge-1',
		description: 'Care with Maria T. · Nov 2 – Nov 4',
		chargedAt: '2026-11-02T13:00:00.000Z',
		totalCents: 13206
	},
	currency: 'CAD',
	helperName: 'Maria T.'
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('refund receipt page', () => {
	it('renders the credit note: number, charge, care, fee and each tax returned', async () => {
		getRefundReceipt.mockResolvedValue({ ok: true, data: { receipt } });
		const app = mount(ReceiptPage, { target: document.body });
		await settle();
		const shown = text();
		const taxes = [...document.querySelectorAll('[data-testid="refund-receipt-tax"]')].map(
			(row) => row.textContent?.replace(/\s+/g, ' ') ?? ''
		);
		const print = [...document.querySelectorAll('button')].find((b) =>
			b.textContent?.includes('Print')
		);
		unmount(app);

		expect(getRefundReceipt).toHaveBeenCalledWith('refund-1');
		expect(shown).toContain('Refund receipt (credit note)');
		expect(shown).toContain('No. CN-000042');
		expect(shown).toContain('Care with Maria T. · Nov 2 – Nov 4');
		expect(shown).toContain('With Maria T.');
		expect(shown).toContain('Care refunded $42.00');
		expect(shown).toContain('Service fee refunded $2.10');
		expect(shown).toContain('Total refunded $50.39');
		expect(taxes).toHaveLength(2);
		expect(taxes[0]).toContain('on $44.10');
		expect(taxes[0]).toContain('Registration no. 123456789RT0001');
		expect(taxes[0]).toContain('$2.21');
		expect(taxes[1]).not.toContain('Registration');
		expect(print).toBeDefined();
	});

	it('says when the refund does not exist', async () => {
		getRefundReceipt.mockResolvedValue({
			ok: false,
			error: { code: 'REFUND_NOT_FOUND', message: 'Refund not found.' }
		});
		const app = mount(ReceiptPage, { target: document.body });
		await settle();
		const shown = text();
		unmount(app);

		expect(shown).toContain('This refund receipt doesn’t exist.');
	});
});
