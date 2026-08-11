// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listContracts, getContractsBadgeCount } = vi.hoisted(() => ({
	listContracts: vi.fn(),
	getContractsBadgeCount: vi.fn()
}));

vi.mock('$lib/api/contracts', () => ({ listContracts, getContractsBadgeCount }));

import ContractsPage from './+page.svelte';

/** A fresh object per call, like a real response — the historical infinite
 * request loop only reproduces when each fetch yields a new reference. */
const freshList = () => ({
	contracts: [
		{
			id: 'contract-1',
			conversationId: 'conversation-1',
			status: 'proposed' as const,
			awaitingYou: false,
			hasNews: false,
			counterpart: {
				userId: 'provider-1',
				name: 'Maria S.',
				city: 'Toronto',
				role: 'service-provider' as const
			},
			serviceNames: ['Childcare', 'School pickup'],
			weeklyEstimateCents: 15000,
			currency: 'CAD',
			endsOn: null,
			updatedAt: new Date().toISOString(),
			createdAt: new Date().toISOString()
		}
	]
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

describe('family contracts list', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('fetches the contract list exactly once on mount and renders the row', async () => {
		listContracts.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: freshList() })))
		);
		getContractsBadgeCount.mockResolvedValue({ ok: true, data: { total: 0 } });

		const app = mount(ContractsPage, { target: document.body });
		await settle();

		const calls = listContracts.mock.calls.length;
		const html = document.body.innerHTML;
		unmount(app);
		expect(calls).toBe(1);
		expect(html).toContain('Maria S.');
		expect(html).toContain('$150.00/wk est.');
	});
});
