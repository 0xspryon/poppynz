// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { previewSessionMoney } = vi.hoisted(() => ({ previewSessionMoney: vi.fn() }));

vi.mock('$lib/api/session-money', () => ({ previewSessionMoney }));

import SessionMoneyPreview from './SessionMoneyPreview.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const preview = (overrides: Record<string, unknown> = {}) => ({
	ok: true,
	data: {
		preview: {
			outcome: 'family_late',
			charged: true,
			familyBackCents: 5039,
			familyPaysCents: 1563,
			helperReceivesCents: 1563,
			held: false,
			...overrides
		}
	}
});

type Props = {
	pending?: unknown;
	minutesWorked?: number | string | null;
	viewerSide?: 'family' | 'provider';
	counterpartName?: string;
};
const render = (props: Props = {}) =>
	mount(SessionMoneyPreview, {
		target: document.body,
		props: {
			contractId: 'contract-1',
			sessionId: 'session-1',
			pending: (props.pending ?? { kind: 'action', action: 'cancel' }) as never,
			minutesWorked: props.minutesWorked ?? null,
			viewerSide: props.viewerSide ?? 'family',
			counterpartName: props.counterpartName ?? 'Maria',
			debounceMs: 0
		}
	});

afterEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
});

describe('SessionMoneyPreview', () => {
	it('tells the family what the helper receives and what comes back once charged', async () => {
		previewSessionMoney.mockResolvedValue(preview());
		const app = render();
		await settle();
		const shown = text();
		unmount(app);

		expect(previewSessionMoney).toHaveBeenCalledWith('contract-1', 'session-1', {
			action: 'cancel'
		});
		expect(shown).toBe('Maria receives $15.63, you get $50.39 back.');
	});

	it('says the hold will not be charged before the cycle is charged', async () => {
		previewSessionMoney.mockResolvedValue(preview({ charged: false }));
		const app = render();
		await settle();
		const shown = text();
		unmount(app);

		expect(shown).toBe('Maria receives $15.63; $50.39 of the hold won’t be charged.');
	});

	it('tells the helper what they receive and what the family gets back', async () => {
		previewSessionMoney.mockResolvedValue(preview());
		const app = render({ viewerSide: 'provider', counterpartName: 'Priya' });
		await settle();
		const shown = text();
		unmount(app);

		expect(shown).toBe('You receive $15.63; Priya gets $50.39 back.');
	});

	it('says nothing moves while a dispute is held, and previews answers too', async () => {
		previewSessionMoney.mockResolvedValue(preview({ outcome: 'held', held: true }));
		const app = render({ pending: { kind: 'response', response: 'contest' } });
		await settle();
		const shown = text();
		unmount(app);

		expect(previewSessionMoney).toHaveBeenCalledWith('contract-1', 'session-1', {
			response: 'contest'
		});
		expect(shown).toBe('Nothing moves until it’s decided.');
	});

	it('shows nothing when there is no preview or the API refuses', async () => {
		previewSessionMoney.mockResolvedValueOnce({ ok: true, data: { preview: null } });
		const first = render();
		await settle();
		const empty = text();
		unmount(first);
		previewSessionMoney.mockResolvedValueOnce({
			ok: false,
			error: { code: 'SESSION_ALREADY_STARTED', message: 'x' }
		});
		const second = render();
		await settle();
		const refused = text();
		unmount(second);

		expect(empty).toBe('');
		expect(refused).toBe('');
	});

	it('waits for the minutes worked before previewing reduced hours', async () => {
		previewSessionMoney.mockResolvedValue(preview({ outcome: 'family_early' }));
		const blank = render({ pending: { kind: 'action', action: 'report_reduced_hours' } });
		await settle();
		const calledWhileBlank = previewSessionMoney.mock.calls.length;
		unmount(blank);
		const filled = render({
			pending: { kind: 'action', action: 'report_reduced_hours' },
			minutesWorked: 60
		});
		await settle();
		unmount(filled);

		expect(calledWhileBlank).toBe(0);
		expect(previewSessionMoney).toHaveBeenCalledWith('contract-1', 'session-1', {
			action: 'report_reduced_hours',
			minutesWorked: 60
		});
	});
});
