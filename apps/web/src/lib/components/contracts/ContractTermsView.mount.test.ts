// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContractTermsView from './ContractTermsView.svelte';

const terms = (overrides: Record<string, unknown> = {}) => ({
	versionId: 'version-1',
	version: 1,
	status: 'accepted',
	proposedByMe: false,
	services: [
		{
			serviceId: 'service-1',
			name: 'Childcare',
			listedRateCents: 2500,
			rateCents: 2600,
			currency: 'CAD',
			sessions: [{ weekday: 4, startMinutes: 540, endMinutes: 1020 }],
			expectations: ''
		}
	],
	startsOn: '2026-10-05',
	endsOn: '2026-12-11',
	endsAtMinutes: 720,
	weeklyEstimateCents: 20800,
	currency: 'CAD',
	sentAt: null,
	expiresAt: null,
	decidedAt: null,
	declineReason: null,
	...overrides
});

describe('ContractTermsView', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it("shows the last-day end time and the family's zone", () => {
		const app = mount(ContractTermsView, {
			target: document.body,
			props: { terms: terms() as never, timeZoneLabel: 'Central Time' }
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain('until 12:00 pm');
		expect(text).toContain("Times are in the family's local time (Central Time)");
	});

	it("speaks to the family as 'your local time'", () => {
		const app = mount(ContractTermsView, {
			target: document.body,
			props: { terms: terms() as never, timeZoneLabel: 'Central Time', viewerIsFamily: true }
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain('Times are in your local time (Central Time)');
		expect(text).not.toContain("family's");
	});

	it('shows no end time for an end date without one', () => {
		const app = mount(ContractTermsView, {
			target: document.body,
			props: { terms: terms({ endsAtMinutes: null }) as never }
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).not.toContain('until');
		expect(text).not.toContain('local time');
	});
});
