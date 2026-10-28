import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	delayText,
	extraSessionChip,
	extraSessionErrorMessage,
	extraSessionStateText,
	minutesToTime,
	timeToMinutes
} from './extra-sessions';

/** Tier 3 step 3: the words for extra sessions, in both languages. */
const row = (overrides: Record<string, unknown> = {}) =>
	({
		id: 'extra-1',
		status: 'agreed',
		chargeState: 'charge_pending',
		date: '2026-11-03',
		startMinutes: 600,
		endMinutes: 720,
		elapsedMinutes: 120,
		serviceId: 'svc-1',
		serviceName: 'Childcare',
		proposedBySide: 'helper',
		proposedByMe: false,
		note: null,
		respondBy: '2026-10-27T12:00:00.000Z',
		respondedAt: null,
		responseNote: null,
		agreedAt: '2026-10-25T12:05:00.000Z',
		chargeAt: '2026-10-25T13:05:00.000Z',
		cancelledAt: null,
		chargedAt: null,
		cycleId: 'cycle-1',
		sessionId: 'session-1',
		familyTotalCents: 5283,
		helperShareCents: null,
		authoriseCents: null,
		lastError: null,
		actions: ['cancel'],
		...overrides
	}) as never;

const plain = (text: string) => text.replace(/\s/g, ' ');

afterEach(() => overwriteGetLocale(() => 'en'));

describe('extra session copy', () => {
	it('states the delay as people say it', () => {
		expect(delayText(60)).toBe('1 hour');
		expect(delayText(120)).toBe('2 hours');
		expect(delayText(45)).toBe('45 minutes');
		expect(delayText(0)).toBe('a few moments');
		overwriteGetLocale(() => 'fr');
		expect(delayText(60)).toBe('1 heure');
		expect(delayText(120)).toBe('2 heures');
	});

	it('tells the family when and how much it will be charged during the delay', () => {
		const text = extraSessionStateText(row(), 'family', 'Maria');
		expect(text).toContain('You’ll be charged $52.83 at');
		expect(text).toContain('Cancelling until then is free.');
		overwriteGetLocale(() => 'fr');
		expect(plain(extraSessionStateText(row(), 'family', 'Maria'))).toContain(
			'52,83 $ sera prélevé le'
		);
	});

	it('never ends a sentence with a double full stop after "p.m."', () => {
		const text = extraSessionStateText(
			row({ status: 'proposed', proposedByMe: true, actions: ['withdraw'] }),
			'family',
			'Maria'
		);
		expect(text).toMatch(/[ap]\.m\. Without an answer/);
		expect(text).not.toContain('..');
		const due = extraSessionStateText(
			row({ status: 'proposed', proposedByMe: false, actions: ['accept', 'decline'] }),
			'helper',
			'Maria'
		);
		expect(due).not.toContain('..');
		// Mid-sentence, "p.m." keeps its full stop.
		expect(extraSessionStateText(row(), 'family', 'Maria')).toMatch(/[ap]\.m\. unless/);
	});

	it('tells the helper they are paid once the charge succeeds', () => {
		expect(extraSessionStateText(row({ status: 'charge_failed' }), 'helper', 'Priya')).toBe(
			'The family’s payment hasn’t gone through yet. You’re paid for this session once it does.'
		);
	});

	it('maps each state to a chip', () => {
		expect(extraSessionChip(row({ status: 'proposed' }))).toEqual({
			status: 'proposed',
			label: 'Awaiting answer'
		});
		expect(extraSessionChip(row({ status: 'charge_failed' })).status).toBe('rejected');
		expect(extraSessionChip(row({ status: 'charged' })).status).toBe('complete');
	});

	it('reads time fields, with an end of midnight as the end of the day', () => {
		expect(timeToMinutes('10:30')).toBe(630);
		expect(timeToMinutes('00:00', true)).toBe(1440);
		expect(timeToMinutes('00:00')).toBe(0);
		expect(timeToMinutes('25:00')).toBeNull();
		expect(timeToMinutes('')).toBeNull();
		expect(minutesToTime(630)).toBe('10:30');
	});

	it('gives every refusal its own toast, in French too', () => {
		expect(extraSessionErrorMessage({ code: 'EXTRA_SESSION_OVERLAP' } as never)).toBe(
			'This time overlaps another session or proposal.'
		);
		expect(
			extraSessionErrorMessage({ code: 'EXTRA_SESSION_INVALID_TIMES' } as never, { minMinutes: 30 })
		).toBe('Choose a start and an end time on the same day, at least 30 minutes apart.');
		overwriteGetLocale(() => 'fr');
		expect(
			extraSessionErrorMessage({ code: 'EXTRA_SESSION_AUTHORISATION_REQUIRED' } as never)
		).toBe('Cochez la case pour autoriser le paiement de cette séance.');
		expect(extraSessionErrorMessage({ code: 'UNEXPECTED' } as never)).toBe(
			'Un problème est survenu avec la séance supplémentaire. Veuillez réessayer.'
		);
	});
});
