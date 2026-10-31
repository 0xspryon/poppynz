// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
	listBillingClockContracts,
	getBillingClockContract,
	runBillingClock,
	toastSuccess,
	toastError
} = vi.hoisted(() => ({
	listBillingClockContracts: vi.fn(),
	getBillingClockContract: vi.fn(),
	runBillingClock: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/billing-clock', () => ({
	listBillingClockContracts,
	getBillingClockContract,
	runBillingClock
}));
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));
vi.mock('$app/state', () => ({ page: { params: { id: 'contract-1' } } }));

import BillingClockPage from './+page.svelte';
import BillingClockContractPage from './[id]/+page.svelte';

/** Staging UAT: the admin billing clock pages (Paraglide falls back to EN). */
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const dialogButton = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
		(button) => button.textContent?.trim() === label
	);

const event = (overrides: Record<string, unknown> = {}) => ({
	kind: 'cycle_hold',
	at: '2026-11-01T05:00:00.000Z',
	label: 'Cycle 1 (2026-11-02 – 2026-11-04): card hold',
	cycleNumber: 1,
	date: '2026-11-02',
	endDate: '2026-11-04',
	subjectId: 'cycle-1',
	withinLimit: true,
	...overrides
});

const run = (overrides: Record<string, unknown> = {}) => ({
	id: 'run-1',
	contractId: 'contract-1',
	actorName: 'Springfield Admin',
	targetAt: '2026-11-01T05:00:00.000Z',
	eventKind: 'cycle_hold',
	eventLabel: 'Cycle 1 (2026-11-02 – 2026-11-04): card hold',
	status: 'succeeded',
	billingStatusBefore: 'scheduled',
	billingStatusAfter: 'scheduled',
	error: null,
	startedAt: '2026-10-31T12:00:00.000Z',
	finishedAt: '2026-10-31T12:00:02.000Z',
	...overrides
});

const detail = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		contract: {
			contractId: 'contract-1',
			familyName: 'Fiona Family',
			helperName: 'Hana Helper',
			status: 'scheduled',
			suspendedReason: null,
			timeZone: 'America/Toronto',
			startsOn: '2026-11-02'
		},
		cycles: [
			{
				id: 'cycle-1',
				number: 1,
				startsOn: '2026-11-02',
				endsOn: '2026-11-04',
				status: 'scheduled',
				familyTotalCents: null,
				holdAt: '2026-11-01T05:00:00.000Z',
				captureAt: '2026-11-02T12:00:00.000Z',
				transferAt: '2026-11-07T05:00:00.000Z'
			}
		],
		events: [event(), event({ kind: 'cycle_capture', at: '2026-11-02T12:00:00.000Z' })],
		runs: [],
		now: '2026-10-31T12:00:00.000Z',
		maxDays: 60,
		...overrides
	}
});

let component: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

describe('the billing clock', () => {
	it('lists live contracts with their next event and the latest runs', async () => {
		listBillingClockContracts.mockResolvedValue({
			ok: true,
			data: {
				contracts: [
					{
						contractId: 'contract-1',
						familyName: 'Fiona Family',
						helperName: 'Hana Helper',
						status: 'active',
						suspendedReason: null,
						startsOn: '2026-11-02',
						nextEvent: event({ kind: 'cycle_capture', at: '2026-11-02T12:00:00.000Z' })
					}
				],
				runs: [run()],
				maxDays: 60
			}
		});
		component = mount(BillingClockPage, { target: document.body });
		await settle();
		expect(text()).toContain('Fiona Family and Hana Helper');
		expect(text()).toContain('Cycle 1: capture');
		expect(document.querySelectorAll('[data-testid="billing-clock-run"]')).toHaveLength(1);
		expect(text()).toContain('Springfield Admin ran up to');
	});

	it('says so when the clock is unavailable', async () => {
		listBillingClockContracts.mockResolvedValue({
			ok: false,
			error: { code: 'NOT_FOUND', message: 'Not found.' }
		});
		component = mount(BillingClockPage, { target: document.body });
		await settle();
		expect(toastError).toHaveBeenCalledWith('The billing clock is not available here.');
		expect(text()).toContain('The billing clock could not be loaded.');
	});
});

describe('one contract on the billing clock', () => {
	it('runs up to an event after confirming, then reloads', async () => {
		getBillingClockContract.mockResolvedValueOnce(detail());
		getBillingClockContract.mockResolvedValueOnce(
			detail({ runs: [run()], events: [event({ kind: 'cycle_capture' })] })
		);
		runBillingClock.mockResolvedValue({ ok: true, data: { run: run() } });
		component = mount(BillingClockContractPage, { target: document.body });
		await settle();
		expect(text()).toContain('Fiona Family and Hana Helper');
		expect(text()).toContain('Cycle 1: card hold');

		document.querySelector<HTMLButtonElement>('[data-testid="billing-clock-run-here"]')!.click();
		flushSync();
		expect(text()).toContain('Run billing up to this event?');
		expect(text()).toContain('Nothing can be undone');
		expect(runBillingClock).not.toHaveBeenCalled();

		dialogButton('Run billing')!.click();
		await settle();
		expect(runBillingClock).toHaveBeenCalledWith('contract-1', '2026-11-01T05:00:00.000Z');
		expect(toastSuccess).toHaveBeenCalledTimes(1);
		expect(getBillingClockContract).toHaveBeenCalledTimes(2);
		expect(document.querySelectorAll('[data-testid="billing-clock-run"]')).toHaveLength(1);
	});

	it('cancelling the dialog runs nothing', async () => {
		getBillingClockContract.mockResolvedValue(detail());
		component = mount(BillingClockContractPage, { target: document.body });
		await settle();
		document.querySelector<HTMLButtonElement>('[data-testid="billing-clock-run-here"]')!.click();
		flushSync();
		dialogButton('Cancel')!.click();
		flushSync();
		expect(runBillingClock).not.toHaveBeenCalled();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});

	it('shows a failed run and a refusal as error toasts', async () => {
		getBillingClockContract.mockResolvedValue(detail());
		runBillingClock.mockResolvedValueOnce({
			ok: true,
			data: { run: run({ status: 'failed', error: '1 item(s) failed' }) }
		});
		runBillingClock.mockResolvedValueOnce({
			ok: false,
			error: { code: 'BILLING_CLOCK_ALREADY_RUNNING', message: 'busy' }
		});
		component = mount(BillingClockContractPage, { target: document.body });
		await settle();
		for (let i = 0; i < 2; i += 1) {
			document.querySelector<HTMLButtonElement>('[data-testid="billing-clock-run-here"]')!.click();
			flushSync();
			dialogButton('Run billing')!.click();
			await settle();
		}
		expect(toastSuccess).not.toHaveBeenCalled();
		expect(toastError.mock.calls.map((call) => call[0])).toEqual([
			expect.stringContaining('but a step failed'),
			'This contract’s billing is already being run. Try again in a moment.'
		]);
	});

	it('disables events beyond the horizon', async () => {
		getBillingClockContract.mockResolvedValue(detail({ events: [event({ withinLimit: false })] }));
		component = mount(BillingClockContractPage, { target: document.body });
		await settle();
		expect(
			document.querySelector<HTMLButtonElement>('[data-testid="billing-clock-run-here"]')!.disabled
		).toBe(true);
		expect(text()).toContain('More than 60 days ahead');
	});
});
