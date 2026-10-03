// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getPayouts, startPayoutsOnboarding, refreshPayouts, openPayoutsDashboard } = vi.hoisted(
	() => ({
		getPayouts: vi.fn(),
		startPayoutsOnboarding: vi.fn(),
		refreshPayouts: vi.fn(),
		openPayoutsDashboard: vi.fn()
	})
);

vi.mock('$lib/api/payouts', () => ({
	getPayouts,
	startPayoutsOnboarding,
	refreshPayouts,
	openPayoutsDashboard
}));

import PayoutsPage from './PayoutsPage.svelte';

const state = (overrides: Record<string, unknown> = {}) => ({
	status: null,
	paymentReady: false,
	requirementsDue: [],
	provider: 'stripe',
	hasAccount: false,
	...overrides
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

describe('PayoutsPage', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('offers "Set up payouts" without an account and sends the helper to Stripe', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state() });
		startPayoutsOnboarding.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/setup/e/acct_1/abc' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, { target: document.body, props: { navigate } });
		await settle();
		button('Set up payouts')?.click();
		await settle();
		unmount(app);
		expect(startPayoutsOnboarding).toHaveBeenCalledTimes(1);
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/abc');
	});

	it('offers "Continue setup" while onboarding', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state({ hasAccount: true, status: 'onboarding' }) });
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const found = button('Continue setup') !== undefined;
		unmount(app);
		expect(found).toBe(true);
	});

	it('lists what Stripe needs and offers "Fix in Stripe" when restricted', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({
				hasAccount: true,
				status: 'restricted',
				requirementsDue: ['A bank account for your payouts', 'Photo ID']
			})
		});
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const items = [...document.querySelectorAll('li')].map((li) => li.textContent?.trim());
		const found = button('Fix in Stripe') !== undefined;
		unmount(app);
		expect(items).toEqual(['A bank account for your payouts', 'Photo ID']);
		expect(found).toBe(true);
	});

	it('says Stripe is reviewing, with no empty list or fix button, when restricted with nothing due', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'restricted', requirementsDue: [] })
		});
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const text = document.body.textContent ?? '';
		const lists = document.querySelectorAll('section ul').length;
		const fix = button('Fix in Stripe') !== undefined;
		unmount(app);
		expect(text).toContain('Stripe is reviewing your details');
		expect(text).not.toContain('Stripe needs a few more details');
		expect(lists).toBe(0);
		expect(fix).toBe(false);
	});

	it('shows a support message and no action when disabled', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state({ hasAccount: true, status: 'disabled' }) });
		const app = mount(PayoutsPage, { target: document.body, props: { navigate: vi.fn() } });
		await settle();
		const text = document.body.textContent ?? '';
		const buttons = document.querySelectorAll('section button').length;
		unmount(app);
		expect(text).toContain('contact Poppynz support');
		expect(buttons).toBe(0);
	});

	it('shows ready and opens the Stripe dashboard', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		openPayoutsDashboard.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/express/acct_1' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, { target: document.body, props: { navigate } });
		await settle();
		const text = document.body.textContent ?? '';
		button('View payouts in Stripe')?.click();
		await settle();
		unmount(app);
		expect(text).toContain('Ready to be paid');
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/express/acct_1');
	});

	it('refreshes from Stripe on return (?from=stripe)', async () => {
		refreshPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		const onreturnhandled = vi.fn();
		const app = mount(PayoutsPage, {
			target: document.body,
			props: { navigate: vi.fn(), returnState: 'stripe', onreturnhandled }
		});
		await settle();
		unmount(app);
		expect(refreshPayouts).toHaveBeenCalledTimes(1);
		expect(getPayouts).not.toHaveBeenCalled();
		expect(onreturnhandled).toHaveBeenCalledTimes(1);
	});

	it('asks for a fresh onboarding link when the old one expired (?refresh=1)', async () => {
		startPayoutsOnboarding.mockResolvedValue({
			ok: true,
			data: { url: 'https://connect.stripe.com/setup/e/acct_1/new' }
		});
		const navigate = vi.fn();
		const app = mount(PayoutsPage, {
			target: document.body,
			props: { navigate, returnState: 'refresh', onreturnhandled: vi.fn() }
		});
		await settle();
		unmount(app);
		expect(navigate).toHaveBeenCalledWith('https://connect.stripe.com/setup/e/acct_1/new');
	});
});
