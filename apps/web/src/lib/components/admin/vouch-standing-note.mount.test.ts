// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/admin-approvals', () => ({ actOnVouch: vi.fn() }));

import type { AdminVouch } from '$lib/api/admin-approvals';
import VouchesCard from './VouchesCard.svelte';

const vouchWith = (status: AdminVouch['status']): AdminVouch => ({
	id: `vouch-${status}`,
	voucher: {
		userId: 'voucher-1',
		name: 'Fiona Family',
		email: 'fiona@example.com',
		role: 'family',
		inGoodStanding: false
	},
	relationship: 'Neighbour',
	status,
	counts: false,
	answers: null,
	attestedAt: null,
	requestedAt: '2026-10-01T12:00:00.000Z',
	decidedAt: null,
	adminReason: null
});

const renderText = (vouch: AdminVouch) => {
	const app = mount(VouchesCard, {
		target: document.body,
		props: { vouches: [vouch], onchanged: async () => {} }
	});
	flushSync();
	const text = document.body.textContent ?? '';
	unmount(app);
	return text;
};

/** The voucher's standing only changes the outcome while the vouch is
 * accepted (it stops counting) or still pending (it won't count once
 * answered). Under a declined, flagged, revoked or expired vouch the note is
 * noise: that vouch never counts anyway. */
describe('VouchesCard: the voucher-standing note', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it.each(['accepted', 'pending'] as const)('shows under a %s vouch', (status) => {
		expect(renderText(vouchWith(status))).toMatch(/no longer approved or is banned/);
	});

	it.each(['declined', 'flagged', 'revoked', 'expired'] as const)(
		'is hidden under a %s vouch',
		(status) => {
			expect(renderText(vouchWith(status))).not.toMatch(/no longer approved/);
		}
	);
});
