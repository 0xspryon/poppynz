// @vitest-environment jsdom
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionMoneyStatus from './SessionMoneyStatus.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const show = (money: unknown, viewerSide: 'family' | 'provider') => {
	const app = mount(SessionMoneyStatus, {
		target: document.body,
		props: { money: money as never, viewerSide }
	});
	const shown = text();
	unmount(app);
	return shown;
};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SessionMoneyStatus', () => {
	it('shows the family its refunds, and that a failed one is followed up', () => {
		const shown = show(
			{
				mechanism: 'refund',
				refunds: [
					{ id: 'r1', status: 'succeeded', totalCents: 5039, refundedAt: '2026-11-04T10:00:00Z' },
					{ id: 'r2', status: 'failed', totalCents: 1200, refundedAt: null }
				],
				transfer: null
			},
			'family'
		);

		expect(shown).toContain('Refund $50.39');
		expect(shown).toContain('Issued');
		expect(shown).toContain('Refund $12.00');
		expect(shown).toContain('Failed');
		expect(shown).toContain('Our team will contact you.');
	});

	it('says a session left out of the charge', () => {
		expect(show({ mechanism: 'excluded', refunds: [], transfer: null }, 'family')).toBe(
			'Left out of the charge'
		);
		expect(show({ mechanism: 'excluded', refunds: [], transfer: null }, 'provider')).toBe(
			'Not paid (left out of the charge)'
		);
	});

	it('shows the helper the transfer of the session, or that it is held', () => {
		expect(
			show(
				{
					mechanism: 'none',
					refunds: [],
					transfer: { status: 'sent', amountCents: 1563, held: false }
				},
				'provider'
			)
		).toBe('$15.63 in your transfer Arriving');
		expect(
			show(
				{
					mechanism: 'held',
					refunds: [],
					transfer: { status: 'due', amountCents: 1563, held: true }
				},
				'provider'
			)
		).toContain('Held until the dispute is decided');
	});

	it('renders nothing without money', () => {
		expect(show(null, 'family')).toBe('');
		expect(show(undefined, 'provider')).toBe('');
	});
});
