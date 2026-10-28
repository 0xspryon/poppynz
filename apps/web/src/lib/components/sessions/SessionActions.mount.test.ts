// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { recordSessionAction, respondToSession, toastSuccess, toastError } = vi.hoisted(() => ({
	recordSessionAction: vi.fn(),
	respondToSession: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/contracts', () => ({ recordSessionAction, respondToSession }));
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import SessionActions from './SessionActions.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const click = (selector: string) => {
	document.querySelector<HTMLButtonElement>(selector)?.click();
	flushSync();
};
const confirmButton = () =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
		(button) => button.textContent?.trim() === 'Confirm'
	);

const session = (overrides: Record<string, unknown> = {}) => ({
	id: 'session-1',
	date: '2026-11-03',
	serviceId: 'svc-1',
	serviceName: 'Childcare',
	startMinutes: 930,
	endMinutes: 1050,
	elapsedMinutes: 120,
	status: 'scheduled',
	startsAt: '2026-11-03T20:30:00.000Z',
	endsAt: '2026-11-03T22:30:00.000Z',
	resolution: null,
	actions: ['cancel', 'propose_day_off'],
	responses: [],
	cancelOutcome: 'family_cancelled_early',
	cutoffAt: '2026-11-02T20:30:00.000Z',
	...overrides
});

const cycle = (overrides: Record<string, unknown> = {}) => ({
	contractId: 'contract-1',
	viewerSide: 'family',
	counterpartName: 'Maria Tester',
	sessionWindow: {
		windowDays: 14,
		cancellationNoticeHours: 24,
		reportResponseHours: 48,
		reportWindowHours: 48
	},
	...overrides
});

let changed = 0;
const render = (sessionOverrides = {}, cycleOverrides = {}) =>
	mount(SessionActions, {
		target: document.body,
		props: {
			session: session(sessionOverrides) as never,
			cycle: cycle(cycleOverrides) as never,
			onchanged: () => (changed += 1)
		}
	});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
	changed = 0;
});

describe('SessionActions (Tier 3)', () => {
	it('offers only the actions the API allows', () => {
		const app = render();
		flushSync();
		expect(
			[...document.querySelectorAll('[data-testid^="session-action-"]')].map((button) =>
				button.textContent?.trim()
			)
		).toEqual(['Cancel session', 'Propose a day off']);
		unmount(app);
	});

	it('links the family to Find help in replacement mode for a session the helper cancelled', () => {
		const app = render({ actions: [], canFindReplacement: true });
		flushSync();
		const link = document.querySelector<HTMLAnchorElement>(
			'[data-testid="session-find-replacement"]'
		);
		expect(link?.textContent?.trim()).toBe('Find a replacement');
		const href = new URL(link!.getAttribute('href')!, 'https://app.test');
		expect(href.pathname).toBe('/family/find');
		expect(Object.fromEntries(href.searchParams)).toEqual({
			service: 'Childcare',
			replace: 'contract-1',
			sessions: 'session-1'
		});
		unmount(app);
	});

	it('lets the proposer withdraw a pending day-off request', async () => {
		recordSessionAction.mockResolvedValue({ ok: true, data: { resolution: {} } });
		const app = render({
			actions: ['withdraw_day_off'],
			resolution: {
				id: 'r-1',
				kind: 'day_off_agreed',
				status: 'proposed',
				reportedBySide: 'family',
				reportedByMe: true,
				recordedAt: '2026-10-30T12:00:00.000Z',
				reason: null,
				note: null,
				minutesWorked: null,
				respondBy: '2026-11-02T20:30:00.000Z',
				response: null,
				respondedByMe: null,
				respondedAt: null,
				responseNote: null,
				decision: null,
				decisionReason: null,
				decidedAt: null,
				countsAs: 'family_cancelled_early',
				policyVersion: 5
			}
		});
		click('[data-testid="session-action-withdraw_day_off"]');
		expect(text()).toContain('Withdraw your day-off request?');
		expect(text()).toContain('The session goes ahead as agreed. Maria Tester is told by email.');
		confirmButton()?.click();
		await settle();
		expect(recordSessionAction).toHaveBeenCalledWith('contract-1', 'session-1', {
			action: 'withdraw_day_off',
			reason: null,
			note: null,
			minutesWorked: null
		});
		expect(toastSuccess).toHaveBeenCalledWith('Request withdrawn. Maria Tester has been told.');
		expect(changed).toBe(1);
		unmount(app);
	});

	it('states the outcome before cancelling, then records it and toasts', async () => {
		recordSessionAction.mockResolvedValue({ ok: true, data: { resolution: {} } });
		const app = render();
		click('[data-testid="session-action-cancel"]');
		expect(text()).toContain('Cancel this session?');
		expect(text()).toContain(
			'This counts as an on-time cancellation: it is at least 24 hours before the session. Maria Tester is told by email right away.'
		);
		const select = document.querySelector<HTMLSelectElement>('[data-testid="session-reason"]')!;
		select.value = 'illness';
		select.dispatchEvent(new Event('change'));
		confirmButton()?.click();
		await settle();
		expect(recordSessionAction).toHaveBeenCalledWith('contract-1', 'session-1', {
			action: 'cancel',
			reason: 'illness',
			note: null,
			minutesWorked: null
		});
		expect(toastSuccess).toHaveBeenCalledWith('Session cancelled. Maria Tester has been told.');
		expect(changed).toBe(1);
		unmount(app);
	});

	it('says a late cancellation is late, and a helper cancellation is the helper’s', () => {
		const late = render({ cancelOutcome: 'family_cancelled_late' });
		click('[data-testid="session-action-cancel"]');
		expect(text()).toContain('This counts as a late cancellation');
		unmount(late);
		document.body.innerHTML = '';
		const helper = render(
			{ cancelOutcome: 'helper_cancelled' },
			{ viewerSide: 'provider', counterpartName: 'Priya Tester' }
		);
		click('[data-testid="session-action-cancel"]');
		expect(text()).toContain('This counts as a cancellation by you, the helper.');
		expect(text()).toContain('can look for a replacement');
		unmount(helper);
	});

	it('toasts a refusal with its own message', async () => {
		recordSessionAction.mockResolvedValue({
			ok: false,
			error: { code: 'SESSION_DAY_OFF_TOO_LATE', message: 'x' }
		});
		const app = render();
		click('[data-testid="session-action-propose_day_off"]');
		confirmButton()?.click();
		await settle();
		expect(toastError).toHaveBeenCalledWith(
			"It's too late to propose a day off for this session. You can cancel it instead."
		);
		unmount(app);
	});

	it('shows the resolution waiting for the viewer, and answers it', async () => {
		respondToSession.mockResolvedValue({ ok: true, data: { resolution: {} } });
		const app = render(
			{
				actions: [],
				responses: ['accept', 'contest'],
				resolution: {
					id: 'resolution-1',
					kind: 'helper_no_show',
					status: 'proposed',
					reportedBySide: 'family',
					reportedByMe: false,
					recordedAt: '2026-11-03T21:00:00.000Z',
					reason: null,
					note: 'Nobody came.',
					minutesWorked: null,
					respondBy: '2026-11-05T21:00:00.000Z',
					response: null,
					respondedByMe: null,
					respondedAt: null,
					responseNote: null,
					decision: null,
					decisionReason: null,
					decidedAt: null,
					countsAs: null,
					policyVersion: 5
				}
			},
			{ viewerSide: 'provider', counterpartName: 'Priya Tester' }
		);
		flushSync();
		expect(text()).toContain('Helper no-show');
		expect(text()).toContain('Awaiting your answer');
		expect(text()).toContain('By Priya Tester');
		expect(text()).toContain('“Nobody came.”');
		expect(text()).toContain('Answer by');
		click('[data-testid="session-respond-contest"]');
		expect(text()).toContain('Contest this report?');
		const note = document.querySelector<HTMLTextAreaElement>('[data-testid="session-note"]')!;
		note.value = 'I was there.';
		note.dispatchEvent(new Event('input'));
		confirmButton()?.click();
		await settle();
		expect(respondToSession).toHaveBeenCalledWith('contract-1', 'session-1', {
			response: 'contest',
			note: 'I was there.'
		});
		expect(toastSuccess).toHaveBeenCalledWith('Sent to Poppynz for review.');
		unmount(app);
	});

	it('checks the minutes worked before reporting reduced hours', async () => {
		const app = render({ actions: ['report_reduced_hours'] }, { viewerSide: 'provider' });
		click('[data-testid="session-action-report_reduced_hours"]');
		const minutes = document.querySelector<HTMLInputElement>('[data-testid="session-minutes"]')!;
		minutes.value = '150';
		minutes.dispatchEvent(new Event('input'));
		confirmButton()?.click();
		await settle();
		expect(recordSessionAction).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledWith(
			'Enter the minutes worked, fewer than the session lasts.'
		);
		unmount(app);
	});

	it('does not read an empty minutes field as 0 minutes worked', async () => {
		const app = render({ actions: ['report_reduced_hours'] }, { viewerSide: 'provider' });
		click('[data-testid="session-action-report_reduced_hours"]');
		confirmButton()?.click();
		await settle();
		expect(recordSessionAction).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledWith(
			'Enter the minutes worked, fewer than the session lasts.'
		);
		unmount(app);
	});
});
