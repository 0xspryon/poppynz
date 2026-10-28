// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listPendingSessionResponses } = vi.hoisted(() => ({
	listPendingSessionResponses: vi.fn()
}));
vi.mock('$lib/api/contracts', () => ({ listPendingSessionResponses }));

import PendingSessionResponses from './PendingSessionResponses.svelte';

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const item = (id: string, kind: string) => ({
	cycleId: 'cycle-1',
	session: {
		id: `session-${id}`,
		date: '2026-11-03',
		serviceName: 'Childcare',
		startMinutes: 930,
		endMinutes: 1050
	},
	resolution: { id, kind, respondBy: '2026-11-05T21:00:00.000Z' }
});

const render = () =>
	mount(PendingSessionResponses, {
		target: document.body,
		props: {
			contractId: 'contract-1',
			counterpartName: 'Priya Tester',
			cycleHref: (cycleId: string) =>
				`/service-provider/contracts/contract-1/cycles/${cycleId}` as never
		}
	});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('PendingSessionResponses', () => {
	it('lists what waits for the viewer, with a count badge and links', async () => {
		listPendingSessionResponses.mockResolvedValue({
			ok: true,
			data: { items: [item('r-1', 'helper_no_show'), item('r-2', 'day_off_agreed')] }
		});
		const app = render();
		await settle();
		expect(listPendingSessionResponses).toHaveBeenCalledWith('contract-1');
		expect(
			document.querySelector('[data-testid="pending-session-badge"]')?.textContent?.trim()
		).toBe('2');
		const body = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
		expect(body).toContain('Waiting for your answer');
		expect(body).toContain('Priya Tester: Helper no-show');
		expect(body).toContain('Priya Tester: Day off');
		expect(document.querySelector('a')?.getAttribute('href')).toBe(
			'/service-provider/contracts/contract-1/cycles/cycle-1'
		);
		unmount(app);
	});

	it('renders nothing when nothing waits', async () => {
		listPendingSessionResponses.mockResolvedValue({ ok: true, data: { items: [] } });
		const app = render();
		await settle();
		expect(document.querySelector('[data-testid="pending-session-responses"]')).toBeNull();
		unmount(app);
	});
});
