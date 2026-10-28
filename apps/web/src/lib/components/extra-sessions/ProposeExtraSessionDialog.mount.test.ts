// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ quoteExtraSession: vi.fn(), proposeExtraSession: vi.fn() }));
const { toastSuccess, toastError } = vi.hoisted(() => ({
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/extra-sessions', () => api);
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import ProposeExtraSessionDialog from './ProposeExtraSessionDialog.svelte';

/** Tier 3 step 3: proposing an extra session, priced live. */
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const settle = async () => {
	for (let i = 0; i < 8; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};
const fill = (testId: string, value: string) => {
	const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
};
const submit = () =>
	document.querySelector<HTMLButtonElement>('[data-testid="extra-session-submit"]')!;

const facts = (viewerSide: 'family' | 'helper') => ({
	canPropose: true,
	refusal: null,
	firstDate: '2026-10-21',
	lastDate: '2026-11-07',
	timeZone: 'America/Toronto',
	timeZoneLabel: 'Eastern Time',
	viewerSide,
	services: [{ serviceId: 'svc-1', name: 'Childcare', rateCents: 2500 }]
});
const policy = {
	lookbackDays: 14,
	chargeDelayMinutes: 60,
	responseHours: 48,
	minMinutes: 15,
	windowDays: 14
};
const quote = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		quote: {
			elapsedMinutes: 120,
			rateCents: 2500,
			careCents: 5000,
			careTaxLines: [],
			feeBps: 500,
			feeCents: 250,
			feeTaxLines: [{ label: 'HST (ON) 13%', taxCents: 33 }],
			familyTotalCents: 5283,
			helperShareCents: null,
			authoriseCents: 5283,
			...overrides
		}
	}
});

const render = (viewerSide: 'family' | 'helper', onclose = vi.fn(), onproposed = vi.fn()) => {
	const component = mount(ProposeExtraSessionDialog, {
		target: document.body,
		props: {
			open: true,
			contractId: 'contract-1',
			facts: facts(viewerSide) as never,
			policy,
			counterpartName: viewerSide === 'family' ? 'Maria' : 'Priya',
			initialDate: '2026-11-03',
			onclose,
			onproposed,
			debounceMs: 0
		}
	});
	// The dialog resets its fields when it opens.
	flushSync();
	return component;
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('ProposeExtraSessionDialog', () => {
	it('prices the slot and only lets the family propose once it authorised that exact amount', async () => {
		api.quoteExtraSession.mockResolvedValue(quote());
		api.proposeExtraSession.mockResolvedValue({ ok: true, data: {} });
		const onclose = vi.fn();
		const onproposed = vi.fn();
		const component = render('family', onclose, onproposed);
		expect(text()).toContain('Maria has 48 hours to confirm it');
		fill('extra-session-start', '10:00');
		fill('extra-session-end', '12:00');
		await settle();
		expect(api.quoteExtraSession).toHaveBeenLastCalledWith('contract-1', {
			date: '2026-11-03',
			startMinutes: 600,
			endMinutes: 720,
			serviceId: 'svc-1'
		});
		expect(text()).toContain('This session costs $52.83: care, the service fee and tax.');
		expect(text()).toContain('your card is charged 1 hour later');
		expect(submit().disabled).toBe(true);
		document
			.querySelector<HTMLInputElement>('[data-testid="extra-session-authorise"] input')!
			.click();
		flushSync();
		expect(submit().disabled).toBe(false);
		submit().click();
		await settle();
		expect(api.proposeExtraSession).toHaveBeenCalledWith('contract-1', {
			date: '2026-11-03',
			startMinutes: 600,
			endMinutes: 720,
			serviceId: 'svc-1',
			note: null,
			authorisedCents: 5283
		});
		expect(toastSuccess).toHaveBeenCalledWith(
			'Extra session proposed. Maria has been asked to confirm it.'
		);
		expect(onproposed).toHaveBeenCalled();
		expect(onclose).toHaveBeenCalled();
		unmount(component);
	});

	it('shows the helper its share and asks no authorisation', async () => {
		api.quoteExtraSession.mockResolvedValue(
			quote({ familyTotalCents: null, helperShareCents: 4212 })
		);
		api.proposeExtraSession.mockResolvedValue({ ok: true, data: {} });
		const component = render('helper');
		fill('extra-session-start', '10:00');
		fill('extra-session-end', '12:00');
		await settle();
		expect(text()).toContain('You’d receive $42.12 for this session.');
		expect(document.querySelector('[data-testid="extra-session-authorise"]')).toBeNull();
		submit().click();
		await settle();
		expect(api.proposeExtraSession).toHaveBeenCalledWith(
			'contract-1',
			expect.objectContaining({ authorisedCents: null })
		);
		unmount(component);
	});

	it('states why the slot is refused instead of a price', async () => {
		api.quoteExtraSession.mockResolvedValue({
			ok: false,
			error: { code: 'EXTRA_SESSION_OVERLAP', message: '' }
		});
		const component = render('family');
		fill('extra-session-start', '15:00');
		fill('extra-session-end', '17:00');
		await settle();
		expect(text()).toContain('This time overlaps another session or proposal.');
		expect(submit().disabled).toBe(true);
		unmount(component);
	});
});
