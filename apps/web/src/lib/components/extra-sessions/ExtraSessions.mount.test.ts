// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	listExtraSessions: vi.fn(),
	respondToExtraSession: vi.fn(),
	withdrawExtraSession: vi.fn(),
	cancelExtraSession: vi.fn(),
	quoteExtraSession: vi.fn(),
	proposeExtraSession: vi.fn()
}));
const { toastSuccess, toastError } = vi.hoisted(() => ({
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/extra-sessions', () => api);
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import ExtraSessions from './ExtraSessions.svelte';

/** Tier 3 step 3: the cycle page's extra sessions. */
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const click = (selector: string) => {
	document.querySelector<HTMLElement>(selector)?.click();
	flushSync();
};
const button = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
		(candidate) => candidate.textContent?.trim() === label
	);

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 'extra-1',
	status: 'proposed',
	chargeState: 'awaiting_answer',
	date: '2026-11-03',
	startMinutes: 600,
	endMinutes: 720,
	elapsedMinutes: 120,
	serviceId: 'svc-1',
	serviceName: 'Childcare',
	proposedBySide: 'helper',
	proposedByMe: false,
	note: 'Mum is away',
	respondBy: '2026-10-27T12:00:00.000Z',
	respondedAt: null,
	responseNote: null,
	agreedAt: null,
	chargeAt: null,
	cancelledAt: null,
	chargedAt: null,
	cycleId: 'cycle-1',
	sessionId: null,
	familyTotalCents: 5283,
	helperShareCents: null,
	authoriseCents: 5283,
	lastError: null,
	actions: ['accept', 'decline'],
	...overrides
});

const listed = (
	rows: Array<Record<string, unknown>>,
	propose: Record<string, unknown> = {},
	viewerSide: 'family' | 'helper' = 'family'
) => ({
	ok: true,
	data: {
		extraSessions: rows,
		propose: {
			canPropose: true,
			refusal: null,
			firstDate: '2026-10-21',
			lastDate: '2026-11-07',
			timeZone: 'America/Toronto',
			timeZoneLabel: 'Eastern Time',
			viewerSide,
			services: [{ serviceId: 'svc-1', name: 'Childcare', rateCents: 2500 }],
			...propose
		},
		policy: {
			lookbackDays: 14,
			chargeDelayMinutes: 60,
			responseHours: 48,
			minMinutes: 15,
			windowDays: 14
		}
	}
});

const render = (props: Record<string, unknown> = {}) =>
	mount(ExtraSessions, {
		target: document.body,
		props: {
			contractId: 'contract-1',
			cycleId: 'cycle-1',
			cycleStatus: 'authorised',
			cycleStartsOn: '2026-11-02',
			counterpartName: 'Maria',
			...props
		}
	});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('ExtraSessions', () => {
	it("makes the family authorise the helper's proposal before confirming it, then says when it is charged", async () => {
		api.listExtraSessions.mockResolvedValue(listed([row()]));
		api.respondToExtraSession.mockResolvedValue({ ok: true, data: {} });
		const component = render();
		await settle();
		expect(text()).toContain(
			'Maria proposed this extra session. Confirm it (authorising the charge)'
		);
		expect(text()).toContain('You pay $52.83');
		click('[data-testid="extra-session-accept"]');
		expect(text()).toContain('I authorise Poppynz to charge my card $52.83 for this session.');
		button('Confirm')!.click();
		await settle();
		expect(api.respondToExtraSession).not.toHaveBeenCalled();
		expect(toastError).toHaveBeenCalledWith(
			'Tick the box to authorise the charge for this session.'
		);
		click('[data-testid="extra-session-authorise"] input');
		button('Confirm')!.click();
		await settle();
		expect(api.respondToExtraSession).toHaveBeenCalledWith('contract-1', 'extra-1', {
			response: 'accept',
			authorisedCents: 5283
		});
		expect(toastSuccess).toHaveBeenCalledWith(
			'Extra session confirmed. You’ll be charged $52.83 in 1 hour unless either of you cancels it.'
		);
		unmount(component);
	});

	it('lets the helper confirm without any authorisation (the family authorised it)', async () => {
		api.listExtraSessions.mockResolvedValue(
			listed(
				[
					row({
						proposedBySide: 'family',
						familyTotalCents: null,
						helperShareCents: 4212,
						authoriseCents: null
					})
				],
				{},
				'helper'
			)
		);
		api.respondToExtraSession.mockResolvedValue({ ok: true, data: {} });
		const component = render({ counterpartName: 'Priya' });
		await settle();
		expect(text()).toContain('You receive $42.12');
		click('[data-testid="extra-session-accept"]');
		expect(document.querySelector('[data-testid="extra-session-authorise"]')).toBeNull();
		button('Confirm')!.click();
		await settle();
		expect(api.respondToExtraSession).toHaveBeenCalledWith('contract-1', 'extra-1', {
			response: 'accept',
			authorisedCents: null
		});
		expect(toastSuccess).toHaveBeenCalledWith(
			'Extra session confirmed. The family is charged in 1 hour.'
		);
		unmount(component);
	});

	it('offers the free cancel during the delay, and toasts a refusal', async () => {
		api.listExtraSessions.mockResolvedValue(
			listed([
				row({
					status: 'agreed',
					chargeState: 'charge_pending',
					chargeAt: '2026-10-25T13:05:00.000Z',
					actions: ['cancel'],
					authoriseCents: null
				})
			])
		);
		api.cancelExtraSession.mockResolvedValue({
			ok: false,
			error: { code: 'EXTRA_SESSION_NOT_CANCELLABLE', message: '' }
		});
		const component = render();
		await settle();
		expect(text()).toContain('You’ll be charged $52.83 at');
		click('[data-testid="extra-session-cancel"]');
		expect(text()).toContain('It hasn’t been charged yet, so cancelling costs nothing.');
		button('Confirm')!.click();
		await settle();
		expect(toastError).toHaveBeenCalledWith(
			'This extra session can no longer be cancelled for free.'
		);
		unmount(component);
	});

	it('invites "Add a session that took place" on a cycle with nothing to bill', async () => {
		api.listExtraSessions.mockResolvedValue(listed([]));
		const component = render({ cycleStatus: 'empty' });
		await settle();
		expect(text()).toContain(
			'Nothing to bill in this cycle. If a session took place anyway, add it'
		);
		click('[data-testid="extra-session-add-past"]');
		expect(document.querySelector('[data-testid="propose-extra-session"]')).not.toBeNull();
		unmount(component);
	});

	it('says why nothing can be proposed while billing is on hold', async () => {
		api.listExtraSessions.mockResolvedValue(
			listed([], { canPropose: false, refusal: 'billing_unavailable' })
		);
		const component = render();
		await settle();
		expect(document.querySelector('[data-testid="extra-session-add"]')).toBeNull();
		expect(text()).toContain(
			'Extra sessions can’t be added while the contract’s billing is on hold.'
		);
		unmount(component);
	});

	it('points the family at its card when the charge was declined', async () => {
		api.listExtraSessions.mockResolvedValue(
			listed([
				row({
					status: 'charge_failed',
					chargeState: 'charge_failed',
					actions: [],
					authoriseCents: null
				})
			])
		);
		const component = render();
		await settle();
		expect(text()).toContain('Your card was declined for this session.');
		expect(text()).toContain('Update your card');
		unmount(component);
	});
});
