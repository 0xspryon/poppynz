// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { orderSafetyCheck, confirmSafetyCheckPayment, getStripe, toast, confirmPayment } =
	vi.hoisted(() => {
		const confirmPayment = vi.fn();
		return {
			toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
			orderSafetyCheck: vi.fn(),
			confirmSafetyCheckPayment: vi.fn(),
			confirmPayment,
			getStripe: vi.fn(async () => ({
				elements: () => ({ create: () => ({ mount: vi.fn() }) }),
				confirmPayment,
				confirmSetup: vi.fn()
			}))
		};
	});

vi.mock('$lib/api/safety-verification', () => ({
	orderSafetyCheck,
	confirmSafetyCheckPayment,
	removeSafetyVerificationItem: vi.fn()
}));
vi.mock('$lib/stripe', () => ({ getStripe }));
vi.mock('$lib/user-language', () => ({
	getUserLanguage: vi.fn(async () => null),
	toStripeLocale: () => 'auto'
}));
vi.mock('$lib/toast.svelte', () => ({ toast }));

import SafetyCheckPanel from './SafetyCheckPanel.svelte';
import { reactiveProps } from './reactive-props.svelte';

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
		quote: {
			amountCents: 7000,
			feeCents: 500,
			taxCents: 0,
			taxLines: [],
			totalCents: 7500,
			currency: 'CAD'
		},
		quoteBlockedReason: null,
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
		totalCents: 7500,
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

/** Scoped to the payment modal — its "Pay $X" submit button text overlaps
 * the basket's "Pay $X and start" button, which stays in the DOM behind it. */
const dialogButton = (label: string) =>
	[...document.querySelectorAll('[role="dialog"] button')].find((candidate) =>
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

	it("labels the modal with the payment's frozen total, not the live quote", async () => {
		// A payment resumed after a price change still charges what its row
		// froze; the live quote in the summary says $75.00.
		orderSafetyCheck.mockResolvedValue(paymentRequired({ totalCents: 6400 }));
		const { app } = await openPanel();
		const pay = [...document.querySelectorAll('[role="dialog"] button')]
			.map((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim())
			.find((label) => label?.startsWith('Pay'));
		unmount(app);

		expect(pay).toBe('Pay $64.00');
	});

	it("shows the server's message when the order conflicts with a payment in progress", async () => {
		const message = 'Your previous payment is still being processed. Check back in a few minutes.';
		orderSafetyCheck.mockResolvedValue({
			ok: false,
			error: { code: 'SAFETY_VERIFICATION_CONFLICT', message }
		});
		const { app } = await openPanel();
		unmount(app);

		expect(toast.error).toHaveBeenCalledWith(message, { title: 'Check not ordered' });
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

	it('treats an intent that already settled elsewhere as paid, and closes the modal', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired());
		confirmPayment.mockResolvedValueOnce({
			error: {
				type: 'invalid_request_error',
				code: 'payment_intent_unexpected_state',
				message: 'The payment intent could not be confirmed because it has a status of succeeded.'
			}
		});
		confirmSafetyCheckPayment.mockResolvedValue({ ok: true, data: { status: 'paid' } });
		const { app, onchanged } = await openPanel();
		dialogButton('Pay $75.00')?.click();
		await settle();
		const dialog = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(confirmSafetyCheckPayment).toHaveBeenCalledWith('payment-1');
		expect(toast.success).toHaveBeenCalledWith(
			'Payment received. We are setting up your check now.'
		);
		expect(dialog).toBeNull();
		expect(onchanged).toHaveBeenCalled();
	});

	it('closes the modal when a realtime refresh shows the order already paid', async () => {
		orderSafetyCheck.mockResolvedValue(paymentRequired());
		const onchanged = vi.fn(async () => {});
		const props = reactiveProps({ summary: summary(), onchanged });
		const app = mount(SafetyCheckPanel, { target: document.body, props });
		flushSync();
		button('Pay $75.00 and start')?.click();
		await settle();
		const dialogWhileOpen = document.querySelector('[role="dialog"]');

		// A webhook, another tab, or the recovery job settled it; the page's
		// realtime refresh (not this test) would normally produce this summary.
		props.summary = summary({ verification: { ...verification, status: 'invited' } });
		flushSync();
		const dialogAfterRefresh = document.querySelector('[role="dialog"]');
		unmount(app);

		expect(dialogWhileOpen).not.toBeNull();
		expect(dialogAfterRefresh).toBeNull();
		expect(toast.success).toHaveBeenCalledWith(
			'Payment received. We are setting up your check now.'
		);
	});
});

describe('SafetyCheckPanel sales tax', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('lists each tax line by type and province, combining the checks and the fee', () => {
		const app = mount(SafetyCheckPanel, {
			target: document.body,
			props: {
				summary: summary({
					quote: {
						amountCents: 7000,
						feeCents: 500,
						taxCents: 975,
						taxLines: [
							{ label: 'HST (ON) 13%', taxCents: 910 },
							{ label: 'HST (ON) 13%', taxCents: 65 }
						],
						totalCents: 8475,
						currency: 'CAD'
					}
				}),
				onchanged: vi.fn(async () => {})
			}
		});
		flushSync();
		expect(document.body.textContent).toContain('HST (ON) 13%');
		expect(document.body.textContent).toContain('$9.75');
		expect(document.body.textContent).not.toContain('Tax$');
		expect(button('Pay $84.75 and start')).toBeDefined();
		unmount(app);
	});

	it('explains a missing province instead of pricing at 0', () => {
		const app = mount(SafetyCheckPanel, {
			target: document.body,
			props: {
				summary: summary({ quote: null, quoteBlockedReason: 'tax_province_required' }),
				onchanged: vi.fn(async () => {})
			}
		});
		flushSync();
		expect(document.body.textContent).toContain('Add your province to your profile address');
		expect(button('and start')).toBeUndefined();
		unmount(app);
	});
});
