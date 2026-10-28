// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listHelperTransfers } = vi.hoisted(() => ({ listHelperTransfers: vi.fn() }));

vi.mock('$lib/api/session-money', () => ({ listHelperTransfers }));

import HelperTransfers from './HelperTransfers.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const transfer = (overrides: Record<string, unknown> = {}) => ({
	id: 'transfer-1',
	contractId: 'contract-1',
	cycleId: 'cycle-1',
	familyName: 'Priya S.',
	cycleStartsOn: '2026-11-02',
	cycleEndsOn: '2026-11-04',
	sequence: 1,
	status: 'arriving',
	amountCents: 3126,
	grossCents: 4689,
	recoveredCents: 1563,
	dueAt: '2026-11-06T13:00:00.000Z',
	sentAt: '2026-11-06T13:00:00.000Z',
	paidAt: null,
	items: [
		{ kind: 'session', amountCents: 3126, sessionDate: '2026-11-02', serviceName: 'Childcare' },
		{ kind: 'held', amountCents: 1563, sessionDate: '2026-11-03', serviceName: 'Childcare' },
		{ kind: 'recovery', amountCents: -1563, sessionDate: '2026-10-28', serviceName: null }
	],
	...overrides
});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('HelperTransfers', () => {
	it('lists transfers with status, amount and the refund deducted', async () => {
		listHelperTransfers.mockResolvedValue({
			ok: true,
			data: {
				transfers: [
					transfer(),
					transfer({
						id: 'transfer-2',
						sequence: 2,
						status: 'held',
						amountCents: null,
						recoveredCents: null,
						sentAt: null,
						items: []
					})
				]
			}
		});
		const app = mount(HelperTransfers, { target: document.body });
		await settle();
		const shown = text();
		const rows = document.querySelectorAll('[data-testid="helper-transfer"]').length;
		unmount(app);

		expect(rows).toBe(2);
		expect(shown).toContain('Priya S.');
		expect(shown).toContain('Mon, Nov 2, 2026 – Wed, Nov 4, 2026');
		expect(shown).toContain('Arriving');
		expect(shown).toContain('$31.26');
		expect(shown).toContain('$15.63 deducted for a refund to the family');
		expect(shown).toContain('follow-up transfer #2');
		expect(shown).toContain('Held');
	});

	it('expands the per-session breakdown, marking held sessions and recoveries', async () => {
		listHelperTransfers.mockResolvedValue({ ok: true, data: { transfers: [transfer()] } });
		const app = mount(HelperTransfers, { target: document.body });
		await settle();
		const hidden = document.querySelector('[data-testid="helper-transfer-items"]');
		document.querySelector<HTMLButtonElement>('[data-testid="helper-transfer-toggle"]')?.click();
		flushSync();
		const items = [...document.querySelectorAll('[data-testid="helper-transfer-items"] li')].map(
			(li) => li.textContent?.replace(/\s+/g, ' ').trim() ?? ''
		);
		unmount(app);

		expect(hidden).toBeNull();
		expect(items).toHaveLength(3);
		expect(items[0]).toContain('Childcare');
		expect(items[0]).toContain('$31.26');
		expect(items[1]).toContain('held until decided');
		expect(items[2]).toContain('Refund to the family for Wed, Oct 28, 2026, deducted');
		expect(items[2]).toContain('−$15.63');
	});

	it('says when there is no transfer yet', async () => {
		listHelperTransfers.mockResolvedValue({ ok: true, data: { transfers: [] } });
		const app = mount(HelperTransfers, { target: document.body });
		await settle();
		const shown = text();
		unmount(app);

		expect(shown).toContain('No transfer yet.');
	});
});
