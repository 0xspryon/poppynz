// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listUnpaidExtraSessions } = vi.hoisted(() => ({ listUnpaidExtraSessions: vi.fn() }));
vi.mock('$lib/api/extra-sessions', () => ({ listUnpaidExtraSessions }));

import UnpaidExtraSessions from './UnpaidExtraSessions.svelte';

/** Tier 3 step 3: the admins' list of extra sessions whose charge is unpaid. */
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('UnpaidExtraSessions', () => {
	it('lists each unpaid extra session with its attempts, next retry and the alert', async () => {
		listUnpaidExtraSessions.mockResolvedValue({
			ok: true,
			data: {
				extraSessions: [
					{
						id: 'extra-1',
						contractId: 'contract-1',
						cycleId: 'cycle-1',
						familyName: 'Priya T.',
						helperName: 'Maria T.',
						date: '2026-11-03',
						startMinutes: 600,
						endMinutes: 720,
						serviceName: 'Childcare',
						status: 'charge_failed',
						totalCents: 5283,
						attempts: 3,
						lastError: 'Your card was declined.',
						dueAt: '2026-11-05T15:00:00.000Z',
						nextRetryAt: null,
						alerted: true
					}
				]
			}
		});
		const component = mount(UnpaidExtraSessions, { target: document.body });
		await settle();
		expect(text()).toContain('Unpaid extra sessions');
		expect(text()).toContain('$52.83');
		expect(text()).toContain('Priya T. · helper Maria T.');
		expect(text()).toContain('Attempts: 3');
		expect(text()).toContain('No more automatic retries; a new card retries it');
		expect(text()).toContain('Unpaid alert raised');
		expect(text()).toContain('Your card was declined.');
		unmount(component);
	});

	it('says when there are none, and shows nothing when the list cannot load', async () => {
		listUnpaidExtraSessions.mockResolvedValueOnce({ ok: true, data: { extraSessions: [] } });
		const empty = mount(UnpaidExtraSessions, { target: document.body });
		await settle();
		expect(text()).toContain('No unpaid extra sessions.');
		unmount(empty);
		document.body.innerHTML = '';
		listUnpaidExtraSessions.mockResolvedValueOnce({
			ok: false,
			error: { code: 'FORBIDDEN', message: '' }
		});
		const failed = mount(UnpaidExtraSessions, { target: document.body });
		await settle();
		expect(text()).toBe('');
		unmount(failed);
	});
});
