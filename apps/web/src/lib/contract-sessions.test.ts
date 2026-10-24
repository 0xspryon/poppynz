import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' as 'en' | 'fr' }));
vi.mock('$lib/paraglide/runtime', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/paraglide/runtime')>()),
	getLocale: () => locale.current
}));

import {
	formatEndTime,
	formatSessionRange,
	minutesToHours,
	noticeLastDay,
	weekdayLabels
} from './contract-sessions';

afterEach(() => {
	locale.current = 'en';
});

describe('formatEndTime', () => {
	it('formats an end time like session times', () => {
		expect(formatEndTime(720)).toBe('12:00 pm');
		expect(formatEndTime(1050)).toBe('5:30 pm');
	});

	it('reads 1440 as midnight, not 12:00 am of the same day', () => {
		expect(formatEndTime(1440)).toBe('midnight');
	});
});

describe('formatSessionRange', () => {
	it('drops the shared suffix in English', () => {
		expect(formatSessionRange({ weekday: 0, startMinutes: 930, endMinutes: 1080 })).toBe(
			'3:30–6:00 pm'
		);
	});

	it('uses the 24-hour Quebec style in French', () => {
		locale.current = 'fr';
		expect(formatSessionRange({ weekday: 0, startMinutes: 930, endMinutes: 1080 })).toBe(
			'15 h 30–18 h'
		);
		expect(formatEndTime(1440)).toBe('minuit');
	});
});

describe('localized labels', () => {
	it('names weekdays Monday-first in the active locale', () => {
		expect(weekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		locale.current = 'fr';
		expect(weekdayLabels()[0]).toBe('lun.');
	});

	it('formats hours with the locale decimal separator', () => {
		expect(minutesToHours(150)).toBe('2.5');
		locale.current = 'fr';
		expect(minutesToHours(150)).toBe('2,5');
		expect(minutesToHours(120)).toBe('2');
	});
});

describe('noticeLastDay', () => {
	it('is notice day + 14 when there is no negotiated end', () => {
		expect(noticeLastDay('2026-10-02', null)).toEqual({
			endsOn: '2026-10-16',
			endsAtMinutes: null
		});
		expect(noticeLastDay('2026-10-02', { endsOn: null, endsAtMinutes: null })).toEqual({
			endsOn: '2026-10-16',
			endsAtMinutes: null
		});
	});

	it('keeps notice + 14 when the negotiated end is later', () => {
		expect(noticeLastDay('2026-10-02', { endsOn: '2026-12-11', endsAtMinutes: 720 })).toEqual({
			endsOn: '2026-10-16',
			endsAtMinutes: null
		});
	});

	it('gives the earlier negotiated end with its end time', () => {
		expect(noticeLastDay('2026-10-02', { endsOn: '2026-10-05', endsAtMinutes: 720 })).toEqual({
			endsOn: '2026-10-05',
			endsAtMinutes: 720
		});
	});

	it('lets the negotiated end win a tie so its end time still applies', () => {
		expect(noticeLastDay('2026-10-02', { endsOn: '2026-10-16', endsAtMinutes: 600 })).toEqual({
			endsOn: '2026-10-16',
			endsAtMinutes: 600
		});
	});
});
