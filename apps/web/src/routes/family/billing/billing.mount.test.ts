// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getBilling, startCardSetup, confirmCardSetup, getStripe, confirmSetup } = vi.hoisted(() => {
	const confirmSetup = vi.fn(async () => ({}));
	return {
		getBilling: vi.fn(),
		startCardSetup: vi.fn(),
		confirmCardSetup: vi.fn(),
		confirmSetup,
		getStripe: vi.fn(async () => ({
			elements: () => ({ create: () => ({ mount: vi.fn() }) }),
			confirmPayment: vi.fn(),
			confirmSetup
		}))
	};
});

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
				taxLines: [{ label: 'HST (ON) 13%', taxCents: 975 }],
				status: 'paid',
				receiptUrl: 'https://pay.stripe.com/receipts/r1'
			},
			{
				id: 'payment-0',
				createdAt: '2026-09-30T10:00:00.000Z',
				description: 'Background check',
				totalCents: 7500,
				currency: 'CAD',
				taxLines: [],
				status: 'failed',
				receiptUrl: null
			}
		],
		provider: 'stripe',
		resumeCharges: [],
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
		expect(text).toContain('Incl. HST (ON) 13% $9.75');
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

	it('never starts a second setup while the card form is open, and confirms the one shown (B1)', async () => {
		getBilling.mockResolvedValue(billing());
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'seti_1', clientSecret: 'seti_1_secret', provider: 'stripe' }
		});
		confirmCardSetup.mockResolvedValue({
			ok: true,
			data: { card: { brand: 'visa', last4: '1881', expMonth: 7, expYear: 2033 } }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Replace card')?.click();
		button('Replace card')?.click();
		await settle();
		const replaceDisabled = button('Replace card')?.disabled;
		button('Replace card')?.click();
		await settle();
		button('Save card')?.click();
		await settle();
		unmount(app);

		expect(startCardSetup).toHaveBeenCalledTimes(1);
		expect(replaceDisabled).toBe(true);
		expect(confirmSetup).toHaveBeenCalledOnce();
		expect(confirmCardSetup).toHaveBeenCalledWith('seti_1');
	});

	it('says what is charged at once when the new card resumes a suspended contract (B2)', async () => {
		getBilling.mockResolvedValue(
			billing({
				resumeCharges: [
					{ contractId: 'contract-1', dates: 'Mon, Nov 2 – Wed, Nov 4', amountCents: 6604 }
				]
			})
		);
		startCardSetup.mockResolvedValue({
			ok: true,
			data: { setupId: 'seti_1', clientSecret: 'seti_1_secret', provider: 'stripe' }
		});
		const app = mount(BillingPage, { target: document.body });
		await settle();
		button('Replace card')?.click();
		await settle();
		const text = document.querySelector('[role="dialog"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
		unmount(app);

		expect(text).toContain('$66.04');
		expect(text).toContain('Mon, Nov 2 – Wed, Nov 4');
		expect(text).not.toContain('Nothing is charged now');
	});

	it('shows a released hold as not charged (L7)', async () => {
		getBilling.mockResolvedValue(
			billing({
				payments: [
					{
						id: 'payment-2',
						createdAt: '2026-11-02T12:00:00.000Z',
						description: 'Care with Sam T. · Mon, Nov 2 – Wed, Nov 4',
						totalCents: 13206,
						currency: 'CAD',
						taxLines: [],
						status: 'released',
						receiptUrl: null
					}
				]
			})
		);
		const app = mount(BillingPage, { target: document.body });
		await settle();
		const text = document.body.textContent ?? '';
		unmount(app);

		expect(text).toContain('Not charged');
		expect(text).not.toContain('Failed');
	});
});
