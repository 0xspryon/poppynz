// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getStripe, stripe, paymentElement } = vi.hoisted(() => {
	const paymentElement = { mount: vi.fn() };
	const elementsGroup = { create: vi.fn(() => paymentElement) };
	const stripe = {
		elements: vi.fn(() => elementsGroup),
		confirmPayment: vi.fn(),
		confirmSetup: vi.fn()
	};
	return { getStripe: vi.fn(async () => stripe), stripe, paymentElement };
});

vi.mock('$lib/stripe', () => ({ getStripe }));

import PaymentModal from './PaymentModal.svelte';

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement;

const baseProps = {
	mode: 'payment' as const,
	clientSecret: 'pi_1_secret',
	title: 'Pay for your checks',
	submitLabel: 'Pay $75.00',
	oncancel: vi.fn()
};

describe('PaymentModal', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('pays with the saved card in one click, without a card form', async () => {
		stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, savedCard: { brand: 'visa', last4: '4242' }, onconfirmed }
		});
		flushSync();
		const label = button('Pay $75.00').textContent?.replace(/\s+/g, ' ').trim();
		const offersAnotherCard = button('Use another card') !== undefined;
		button('Pay $75.00').click();
		await settle();
		unmount(app);

		expect(label).toBe('Pay $75.00 with Visa •••• 4242');
		expect(offersAnotherCard).toBe(true);
		expect(stripe.elements).not.toHaveBeenCalled();
		expect(stripe.confirmPayment).toHaveBeenCalledWith({
			clientSecret: 'pi_1_secret',
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});

	it('switches to the card form for another card', async () => {
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, savedCard: { brand: 'visa', last4: '4242' }, onconfirmed: vi.fn() }
		});
		flushSync();
		button('Use another card').click();
		await settle();
		unmount(app);

		expect(stripe.elements).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret' });
		expect(paymentElement.mount).toHaveBeenCalledOnce();
	});

	it('confirms a new card through the Payment Element and shows the notice', async () => {
		stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: {
				...baseProps,
				notice: 'Your card will be saved for future Poppynz payments.',
				onconfirmed
			}
		});
		await settle();
		const text = document.body.textContent;
		button('Pay $75.00').click();
		await settle();
		unmount(app);

		expect(text).toContain('Your card will be saved for future Poppynz payments.');
		expect(stripe.confirmPayment).toHaveBeenCalledWith({
			elements: expect.anything(),
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});

	it("shows Stripe's message for a refused card, ends the attempt and reports it", async () => {
		stripe.confirmPayment.mockResolvedValue({
			error: { type: 'card_error', message: 'Your card was declined.' }
		});
		const onconfirmed = vi.fn(async () => {});
		const onfailed = vi.fn();
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, onconfirmed, onfailed }
		});
		await settle();
		button('Pay $75.00').click();
		await settle();
		const alert = document.querySelector('[role="alert"]')?.textContent;
		const closeLabel = button('Close')?.textContent?.trim();
		unmount(app);

		expect(alert).toBe('Your card was declined.');
		expect(closeLabel).toBe('Close');
		expect(onfailed).toHaveBeenCalledOnce();
		expect(onconfirmed).not.toHaveBeenCalled();
	});

	it('keeps the form open on a validation error', async () => {
		stripe.confirmPayment.mockResolvedValue({
			error: { type: 'validation_error', message: 'Your card number is incomplete.' }
		});
		const onfailed = vi.fn();
		const app = mount(PaymentModal, {
			target: document.body,
			props: { ...baseProps, onconfirmed: vi.fn(), onfailed }
		});
		await settle();
		button('Pay $75.00').click();
		await settle();
		const stillPayable = button('Pay $75.00') !== undefined;
		unmount(app);

		expect(onfailed).not.toHaveBeenCalled();
		expect(stillPayable).toBe(true);
	});

	it('confirms a card setup in setup mode', async () => {
		stripe.confirmSetup.mockResolvedValue({ setupIntent: { status: 'succeeded' } });
		const onconfirmed = vi.fn(async () => {});
		const app = mount(PaymentModal, {
			target: document.body,
			props: {
				...baseProps,
				mode: 'setup',
				clientSecret: 'seti_1_secret',
				title: 'Add a card',
				submitLabel: 'Save card',
				onconfirmed
			}
		});
		await settle();
		button('Save card').click();
		await settle();
		unmount(app);

		expect(stripe.elements).toHaveBeenCalledWith({ clientSecret: 'seti_1_secret' });
		expect(stripe.confirmSetup).toHaveBeenCalledWith({
			elements: expect.anything(),
			redirect: 'if_required'
		});
		expect(onconfirmed).toHaveBeenCalledOnce();
	});
});
