// @vitest-environment jsdom
// Tier 3 step 2: the cycle page's compensation line and the helper's transfers.
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getContractCycle, retryContractPayment } = vi.hoisted(() => ({
	getContractCycle: vi.fn(),
	retryContractPayment: vi.fn()
}));

vi.mock('$lib/api/contracts', () => ({ getContractCycle, retryContractPayment }));
vi.mock('$app/state', () => ({ page: { params: { id: 'contract-1', cycleId: 'cycle-1' } } }));

import ContractCyclePage from './ContractCyclePage.svelte';

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const textOf = (selector: string) =>
	document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ') ?? '';

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
	transferAt: '2026-11-06T13:00:00.000Z',
	timeZone: 'America/Winnipeg',
	timeZoneLabel: 'Central Time',
	viewerSide: 'provider',
	counterpartName: 'Priya S.',
	billingStatus: 'active',
	suspendedReason: null,
	amounts: {
		side: 'provider',
		serviceCents: 60000,
		serviceTaxLines: [],
		commissionBps: 1500,
		commissionCents: 9000,
		commissionTaxLines: [],
		shareCents: 51000,
		compensationCents: 1563
	},
	estimatedServiceCents: 60000,
	carriedInCents: 0,
	sessions: [],
	transfers: [
		{
			id: 'transfer-1',
			sequence: 1,
			status: 'sent',
			amountCents: 49437,
			recoveredCents: 1563,
			dueAt: '2026-11-06T13:00:00.000Z',
			sentAt: '2026-11-06T13:00:00.000Z'
		}
	],
	sessionWindow: {
		windowDays: 14,
		cancellationNoticeHours: 24,
		reportResponseHours: 48,
		reportWindowHours: 48
	},
	canRetryPayment: false,
	...overrides
});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('ContractCyclePage money', () => {
	it('shows the compensation line and the helper’s transfers', async () => {
		getContractCycle.mockResolvedValue({ ok: true, data: { cycle: cycle() } });
		const app = mount(ContractCyclePage, {
			target: document.body,
			props: { role: 'service-provider' }
		});
		await settle();
		const compensation = textOf('[data-testid="cycle-compensation"]');
		const transfers = textOf('[data-testid="cycle-transfers"]');
		unmount(app);

		expect(compensation).toContain('Late-cancellation compensation');
		expect(compensation).toContain('$15.63');
		expect(transfers).toContain('Transfer #1');
		expect(transfers).toContain('Arriving');
		expect(transfers).toContain('$494.37');
		expect(transfers).toContain('Refund deducted');
	});

	it('shows the family no transfers and no compensation line when there is none', async () => {
		getContractCycle.mockResolvedValue({
			ok: true,
			data: {
				cycle: cycle({
					viewerSide: 'family',
					transfers: [],
					amounts: {
						side: 'family',
						serviceCents: 60000,
						serviceTaxLines: [],
						feeBps: 500,
						feeCents: 3000,
						feeTaxLines: [],
						totalCents: 63000,
						chargedCents: 63000,
						compensationCents: 0
					}
				})
			}
		});
		const app = mount(ContractCyclePage, { target: document.body, props: { role: 'family' } });
		await settle();
		const compensation = document.querySelector('[data-testid="cycle-compensation"]');
		const transfers = document.querySelector('[data-testid="cycle-transfers"]');
		unmount(app);

		expect(compensation).toBeNull();
		expect(transfers).toBeNull();
	});
});
