// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getBilling, startCardSetup, confirmCardSetup, getStripe } = vi.hoisted(() => ({
	getBilling: vi.fn(),
	startCardSetup: vi.fn(),
	confirmCardSetup: vi.fn(),
	getStripe: vi.fn(async () => ({
		elements: () => ({ create: () => ({ mount: vi.fn() }) }),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	}))
}));

vi.mock('$lib/api/billing', () => ({ getBilling, startCardSetup, confirmCardSetup }));
vi.mock('$lib/stripe', () => ({ getStripe }));

import BillingPage from './+page.svelte';

const billing = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
		payments: [
			{
				id: 'payment-1',
				createdAt: '2026-10-01T10:00:00.000Z',
				description: 'Background check',
				totalCents: 7500,
				currency: 'CAD',
				status: 'paid',
				receiptUrl: 'https://pay.stripe.com/receipts/r1'
			},
			{
				id: 'payment-0',
				createdAt: '2026-09-30T10:00:00.000Z',
				description: 'Background check',
				totalCents: 7500,
				currency: 'CAD',
				status: 'failed',
				receiptUrl: null
			}
		],
		provider: 'stripe',
		...overrides
	}
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement | undefined;

describe('family billing page', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('shows the card on file with Replace, and the payment history with receipts', async () => {
		getBilling.mockResolvedValue(billing());
		const app = mount(BillingPage, { target: document.body });
		await settle();
		const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
		const receipts = [...document.querySelectorAll('a')].filter((a) =>
			a.textContent?.includes('Receipt')
		);
		const replace = button('Replace card');
		unmount(app);

		expect(text).toContain('Visa •••• 4242');
		expect(text).toContain('Expires 12/2034');
		expect(replace).toBeDefined();
		expect(text).toContain('Paid');
		expect(text).toContain('Failed');
		expect(text).toContain('$75.00');
		expect(receipts).toHaveLength(1);
		expect(receipts[0]?.getAttribute('href')).toBe('https://pay.stripe.com/receipts/r1');
	});

	it('offers Add a card when there is none', async () => {
		getBilling.mockResolvedValue(billing({ card: null, payments: [] }));
		const app = mount(BillingPage, { target: document.body });
		await settle();
		const add = button('Add a card');
		const text = document.body.textContent ?? '';
		unmount(app);

		expect(add).toBeDefined();
		expect(text).toContain('No payments yet.');
	});

	it('opens the card form in setup mode for Stripe', async () => {
		getBilling.mockResolvedValue(billing({ card: null }));
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'seti_1', clientSecret: 'seti_1_secret', provider: 'stripe' }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Add a card')?.click();
		await settle();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog?.getAttribute('aria-label')).toBe('Add a card');
		expect(confirmCardSetup).not.toHaveBeenCalled();
	});

	it('saves straight away with the mock provider — no card form', async () => {
		getBilling.mockResolvedValue(billing({ card: null, provider: 'mock' }));
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'mock_seti_1', clientSecret: 'mock_secret', provider: 'mock' }
		});
		confirmCardSetup.mockResolvedValue({
			ok: true,
			data: { card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 } }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Add a card')?.click();
		await settle();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog).toBeNull();
		expect(confirmCardSetup).toHaveBeenCalledWith('mock_seti_1');
		expect(getBilling).toHaveBeenCalledTimes(2);
	});
});
