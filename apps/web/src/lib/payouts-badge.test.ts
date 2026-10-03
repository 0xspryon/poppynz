import { afterEach, describe, expect, it, vi } from 'vitest';

const { getPayouts } = vi.hoisted(() => ({ getPayouts: vi.fn() }));
vi.mock('$lib/api/payouts', () => ({ getPayouts }));

import { payoutsBadge } from './payouts-badge.svelte';

const state = (overrides: Record<string, unknown> = {}) => ({
	status: null,
	paymentReady: false,
	requirementsDue: [],
	provider: 'stripe',
	hasAccount: false,
	...overrides
});

describe('payoutsBadge', () => {
	afterEach(() => {
		vi.clearAllMocks();
		payoutsBadge.needsSetup = false;
	});

	it('flags a helper with no payout account', async () => {
		getPayouts.mockResolvedValue({ ok: true, data: state() });
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});

	it('flags an account that is not ready yet', async () => {
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'restricted' })
		});
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});

	it('clears once the account is ready', async () => {
		payoutsBadge.needsSetup = true;
		getPayouts.mockResolvedValue({
			ok: true,
			data: state({ hasAccount: true, status: 'ready', paymentReady: true })
		});
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(false);
	});

	it('keeps the last value when the request fails', async () => {
		payoutsBadge.needsSetup = true;
		getPayouts.mockResolvedValue({ ok: false, error: { code: 'UNEXPECTED', message: 'x', status: null } });
		await payoutsBadge.refresh();
		expect(payoutsBadge.needsSetup).toBe(true);
	});
});
