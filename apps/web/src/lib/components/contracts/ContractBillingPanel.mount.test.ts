// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContractBillingPanel from './ContractBillingPanel.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

const cycle = (overrides: Record<string, unknown> = {}) => ({
	id: 'cycle-1',
	index: 0,
	startsOn: '2026-11-02',
	endsOn: '2026-11-04',
	status: 'captured',
	holdAt: '2026-10-31T04:00:00.000Z',
	captureAt: '2026-11-02T12:00:00.000Z',
	transferAt: null,
	sessionCount: 2,
	suspendedSessionCount: 0,
	minutes: 300,
	amountCents: 13206,
	taxLines: [{ label: 'HST (ON) 13%', taxCents: 81 }],
	...overrides
});

const render = (billing: Record<string, unknown>, viewerSide: 'family' | 'provider' = 'family') => {
	const app = mount(ContractBillingPanel, {
		target: document.body,
		props: {
			billing: {
				status: 'active',
				suspendedReason: null,
				readinessDeadline: null,
				feeBps: 500,
				cycles: [cycle()],
				...billing
			} as never,
			viewerSide,
			counterpartFirstName: 'Sam',
			billingHref: '/family/billing',
			payoutsHref: '/service-provider/payouts'
		}
	});
	flushSync();
	return app;
};

describe('ContractBillingPanel', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it("lists each cycle with the viewer's amount and status", () => {
		const app = render({
			cycles: [
				cycle(),
				cycle({
					id: 'cycle-2',
					index: 1,
					startsOn: '2026-11-05',
					endsOn: '2026-11-07',
					status: 'authorised',
					amountCents: 6603
				})
			]
		});
		expect(text()).toContain('2 sessions · 5 hrs');
		expect(text()).toContain('$132.06');
		expect(text()).toContain('Paid');
		expect(text()).toContain('On hold');
		expect(text()).toContain('incl. HST (ON) 13%');
		unmount(app);
	});

	it('tells a family with a declined card how to resume', () => {
		const app = render({
			status: 'suspended',
			suspendedReason: 'card',
			cycles: [cycle({ status: 'suspended' })]
		});
		expect(text()).toContain('Your card was declined');
		expect(text()).toContain('Suspended — not billed');
		const link = [...document.querySelectorAll('a')].find((a) =>
			a.textContent?.includes('Update your card')
		);
		expect(link?.getAttribute('href')).toBe('/family/billing');
		unmount(app);
	});

	it("words the helper's cycle as a share after commission, never 'incl.' (B7)", () => {
		const app = render({ cycles: [cycle()] }, 'provider');
		expect(text()).toContain('your share after Poppynz commission');
		expect(text()).not.toContain('incl.');
		unmount(app);
	});

	it('tells the helper not to work suspended days', () => {
		const app = render({ status: 'suspended', suspendedReason: 'card' }, 'provider');
		expect(text()).toContain("Don't work suspended days");
		unmount(app);
	});

	it('asks a helper awaiting payment readiness to set up payouts before the deadline', () => {
		const app = render(
			{
				status: 'awaiting_payment_readiness',
				readinessDeadline: '2026-11-02T12:00:00.000Z',
				cycles: []
			},
			'provider'
		);
		expect(text()).toContain('Set up your payout account by');
		const link = [...document.querySelectorAll('a')].find((a) =>
			a.textContent?.includes('Set up payouts')
		);
		expect(link?.getAttribute('href')).toBe('/service-provider/payouts');
		unmount(app);
	});
});
