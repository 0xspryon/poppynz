// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { orderSafetyCheck, confirmSafetyCheckPayment, getStripe } = vi.hoisted(() => ({
	orderSafetyCheck: vi.fn(),
	confirmSafetyCheckPayment: vi.fn(),
	getStripe: vi.fn(async () => ({
		elements: () => ({ create: () => ({ mount: vi.fn() }) }),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	}))
}));

vi.mock('$lib/api/safety-verification', () => ({
	orderSafetyCheck,
	confirmSafetyCheckPayment,
	removeSafetyVerificationItem: vi.fn()
}));
vi.mock('$lib/stripe', () => ({ getStripe }));

import SafetyCheckPanel from './SafetyCheckPanel.svelte';

const verification = {
	status: 'not_started',
	route: null,
	consentAt: null,
	issuedOn: null,
	expiresOn: null,
	decisionReason: null,
	applicationUrl: null,
	cost: null
};

const summary = (overrides: Record<string, unknown> = {}) =>
	({
		verification,
		basket: [
			{
				id: 'item-1',
				documentTypeId: 'type-1',
				name: 'Criminal record check',
				credibledLabel: 'Enhanced',
				costCents: 7000
			}
		],
		quote: { amountCents: 7000, feeCents: 500, taxCents: 0, totalCents: 7500, currency: 'CAD' },
		orderableCheckTypes: [{ documentTypeId: 'type-1' }],
		canOrderThroughCredibled: true,
		canResumePayment: false,
		...overrides
	}) as never;

const paymentRequired = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		status: 'payment_required',
		paymentId: 'payment-1',
		clientSecret: 'pi_1_secret',
		provider: 'stripe',
		savesCard: false,
		savedCard: null,
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

const openPanel = async (props: Record<string, unknown> = {}) => {
	const onchanged = vi.fn(async () => {});
	const app = mount(SafetyCheckPanel, {
		target: document.body,
		props: { summary: summary(), onchanged, ...props }
	});
	flushSync();
	button('Pay $75.00 and start')?.click();
	await settle();
	return { app, onchanged };
};

describe('SafetyCheckPanel payment', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('opens the plain card form for a helper', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired());
		const { app } = await openPanel();
		const dialog = document.querySelector('[role="dialog"]');
		const text = dialog?.textContent ?? '';
		unmount(app);

		expect(dialog).not.toBeNull();
		expect(text).not.toContain('Your card will be saved');
		expect(text).not.toContain('Use another card');
	});

	it('tells a family paying with a new card that it will be kept', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired({ savesCard: true }));
		const { app } = await openPanel();
		const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
		unmount(app);

		expect(text).toContain(
			'Your card will be saved for future Poppynz payments, such as contract billing. You can replace it in Billing.'
		);
	});

	it('offers a family with a saved card one-click payment and another card', async () => {
		orderSafetyCheck.mockResolvedValue(
			paymentRequired({ savedCard: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 } })
		);
		const { app } = await openPanel();
		const oneClick = button('with Visa')?.textContent?.replace(/\s+/g, ' ').trim();
		const another = button('Use another card');
		unmount(app);

		expect(oneClick).toBe('Pay $75.00 with Visa •••• 4242');
		expect(another).toBeDefined();
	});

	it('shows no modal when the provider settled at once (the mock)', async () => {
		orderSafetyCheck.mockResolvedValue({ ok: true, data: { status: 'paid', verification: {} } });
		const { app, onchanged } = await openPanel();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialog).toBeNull();
		expect(onchanged).toHaveBeenCalledOnce();
	});

	it('offers to continue a payment that was started and never finished', async () => {
		const app = mount(SafetyCheckPanel, {
			target: document.body,
			props: {
				summary: summary({
					verification: { ...verification, status: 'payment_pending' },
					canResumePayment: true
				}),
				onchanged: vi.fn(async () => {})
			}
		});
		flushSync();
		const resume = button('Continue payment');
		unmount(app);

		expect(resume).toBeDefined();
	});
});
