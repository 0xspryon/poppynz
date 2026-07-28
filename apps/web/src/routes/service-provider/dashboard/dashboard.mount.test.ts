// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getOnboardingState, submitApprovalRequest } = vi.hoisted(() => ({
	getOnboardingState: vi.fn(),
	submitApprovalRequest: vi.fn()
}));

vi.mock('$lib/api/onboarding', () => ({ getOnboardingState, submitApprovalRequest }));

import DashboardPage from './+page.svelte';

/** A fresh object per call, like a real response — the historical infinite
 * request loop only reproduces when each fetch yields a new reference. */
const freshOnboardingState = () => ({
	userId: 'user-1',
	firstName: 'Pat',
	lastName: 'Helper',
	progress: { completed: 1, total: 4 },
	steps: {
		profile: { complete: false, missingFields: ['phoneNumber'] },
		documents: { complete: false, requiredSubmitted: 1, requiredTotal: 3 },
		services: { complete: false, count: 0 }
	},
	documents: [],
	approval: null,
	latestApprovalRequest: null,
	canSubmit: true,
	warnings: { missingRequiredDocuments: [], missingServicesOffered: true }
});

/** Several macrotask turns: the buggy `$effect(() => void load())` version
 * schedules another fetch after every response, so the call count climbs
 * with each turn; the onMount version stays at one. */
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

describe('service-provider dashboard', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('fetches the onboarding state exactly once on mount', async () => {
		// Resolve on a macrotask: the buggy variant's fetch loop is
		// microtask-only and would starve timers, hanging the runner instead
		// of failing the assertion.
		getOnboardingState.mockImplementation(
			() =>
				new Promise((resolve) =>
					setTimeout(() => resolve({ ok: true, data: freshOnboardingState() }))
				)
		);

		const app = mount(DashboardPage, { target: document.body });
		await settle();

		// Unmount before asserting: if the regression returns, a failing
		// assertion must not leave the request loop running and hang vitest.
		const calls = getOnboardingState.mock.calls.length;
		unmount(app);
		expect(calls).toBe(1);
	});
});
