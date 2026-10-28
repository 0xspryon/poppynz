// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getContractCycle, retryContractPayment } = vi.hoisted(() => ({
	getContractCycle: vi.fn(),
	retryContractPayment: vi.fn()
}));

vi.mock('$lib/api/contracts', () => ({ getContractCycle, retryContractPayment }));
// Tier 3 step 3: the extra sessions (tested in their own suites).
vi.mock('$lib/api/extra-sessions', () => ({
	listExtraSessions: vi.fn(async () => ({ ok: false, error: { code: 'UNEXPECTED' } })),
	listUnpaidExtraSessions: vi.fn(async () => ({ ok: true, data: { extraSessions: [] } }))
}));
vi.mock('$app/state', () => ({ page: { params: { id: 'contract-1', cycleId: 'cycle-1' } } }));

import ContractCyclePage from './ContractCyclePage.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const session = {
	id: 'session-1',
	date: '2026-11-03',
	serviceId: 'svc-1',
	serviceName: 'Childcare',
	startMinutes: 930,
	endMinutes: 1050,
	elapsedMinutes: 120,
	status: 'completed',
	startsAt: '2026-11-03T21:30:00.000Z',
	endsAt: '2026-11-03T23:30:00.000Z',
	resolution: null,
	actions: [],
	responses: [],
	cancelOutcome: null,
	cutoffAt: '2026-11-02T21:30:00.000Z'
};

const cycle = (overrides: Record<string, unknown> = {}) => ({
	id: 'cycle-1',
	contractId: 'contract-1',
	index: 1,
	startsOn: '2026-11-02',
	endsOn: '2026-11-04',
	status: 'captured',
	startsAt: '2026-11-02T06:00:00.000Z',
	endsAt: '2026-11-05T06:00:00.000Z',
	holdAt: '2026-11-01T06:00:00.000Z',
	captureAt: '2026-11-02T13:00:00.000Z',
	transferAt: null,
	timeZone: 'America/Winnipeg',
	timeZoneLabel: 'Central Time',
	viewerSide: 'family',
	counterpartName: 'Maria Tester',
	billingStatus: 'active',
	suspendedReason: null,
	amounts: {
		side: 'family',
		serviceCents: 60000,
		serviceTaxLines: [],
		feeBps: 500,
		feeCents: 3000,
		feeTaxLines: [{ label: 'GST (MB) 5%', taxCents: 150 }],
		totalCents: 63150,
		chargedCents: 63150
	},
	estimatedServiceCents: 5200,
	carriedInCents: 0,
	sessions: [session],
	sessionWindow: {
		windowDays: 14,
		cancellationNoticeHours: 24,
		reportResponseHours: 48,
		reportWindowHours: 48
	},
	canRetryPayment: false,
	...overrides
});

describe('ContractCyclePage (UAT round 2 #11a)', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it("shows the family's amounts and the cycle's sessions, with an empty actions slot", async () => {
		getContractCycle.mockResolvedValue({ ok: true, data: { cycle: cycle() } });
		const app = mount(ContractCyclePage, { target: document.body, props: { role: 'family' } });
		await settle();
		expect(getContractCycle).toHaveBeenCalledWith('contract-1', 'cycle-1');
		expect(text()).toContain('Billing cycle 2');
		expect(text()).toContain('Contract with Maria Tester');
		expect(text()).toContain('You pay $631.50');
		expect(text()).toContain('GST (MB) 5% on the fee +$1.50');
		expect(text()).toContain('Childcare');
		expect(text()).toContain('Times in Central Time');
		// Tier 3: the window explainer, with the numbers from the API.
		expect(
			document
				.querySelector('[data-testid="session-window-note"]')
				?.textContent?.replace(/\s+/g, ' ')
		).toContain('Sessions appear 14 days ahead.');
		expect(document.querySelectorAll('[data-testid="cycle-session"]')).toHaveLength(1);
		// No actions snippet, no actions row.
		expect(document.querySelector('[data-testid="cycle-session-actions"]')).toBeNull();
		expect(document.querySelector('[data-testid="retry-payment"]')).toBeNull();
		unmount(app);
	});

	it("shows the helper's share and renders Tier 3 session actions when given", async () => {
		getContractCycle.mockResolvedValue({
			ok: true,
			data: {
				cycle: cycle({
					viewerSide: 'provider',
					transferAt: '2026-11-07T06:00:00.000Z',
					amounts: {
						side: 'provider',
						serviceCents: 60000,
						serviceTaxLines: [],
						commissionBps: 1500,
						commissionCents: 9000,
						commissionTaxLines: [{ label: 'HST (ON) 13%', taxCents: 1170 }],
						shareCents: 49830
					}
				})
			}
		});
		const sessionActions = createRawSnippet(() => ({
			render: () => '<button type="button">Report</button>'
		}));
		const app = mount(ContractCyclePage, {
			target: document.body,
			props: { role: 'service-provider', sessionActions }
		});
		await settle();
		expect(text()).toContain('You receive $498.30');
		expect(text()).toContain('Sent to your payout account');
		expect(text()).not.toContain('You pay');
		expect(document.querySelector('[data-testid="cycle-session-actions"]')?.textContent).toContain(
			'Report'
		);
		unmount(app);
	});

	it('offers Retry payment on a declined cycle and refetches after it', async () => {
		getContractCycle.mockResolvedValue({
			ok: true,
			data: { cycle: cycle({ status: 'grace', amounts: null, canRetryPayment: true }) }
		});
		retryContractPayment.mockResolvedValue({ ok: true, data: { outcome: 'declined' } });
		const app = mount(ContractCyclePage, { target: document.body, props: { role: 'family' } });
		await settle();
		expect(text()).toContain('The scheduled care is worth $52.00 so far');
		document.querySelector<HTMLButtonElement>('[data-testid="retry-payment"]')?.click();
		await settle();
		expect(retryContractPayment).toHaveBeenCalledWith('contract-1');
		expect(getContractCycle).toHaveBeenCalledTimes(2);
		unmount(app);
	});

	it('marks an extra session in the timetable (Tier 3 step 3)', async () => {
		getContractCycle.mockResolvedValue({
			ok: true,
			data: {
				cycle: cycle({
					sessions: [session, { ...session, id: 'session-extra', origin: 'extra' }]
				})
			}
		});
		const app = mount(ContractCyclePage, { target: document.body, props: { role: 'family' } });
		await settle();
		expect(document.querySelectorAll('[data-testid="cycle-session-extra"]')).toHaveLength(1);
		expect(document.querySelector('[data-testid="cycle-session-extra"]')?.textContent?.trim()).toBe(
			'Extra'
		);
		unmount(app);
	});

	it('says when the cycle does not exist', async () => {
		getContractCycle.mockResolvedValue({
			ok: false,
			error: { code: 'CONTRACT_CYCLE_NOT_FOUND', message: 'x' }
		});
		const app = mount(ContractCyclePage, { target: document.body, props: { role: 'family' } });
		await settle();
		expect(text()).toContain("This billing cycle doesn't exist.");
		unmount(app);
	});
});
