import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	formatCalendarDate,
	formatDate,
	formatDateTime,
	formatDateTimeIn,
	formatDateWithWeekday,
	relativeDayLabel,
	toDateInputValue
} from './date';

describe('formatDate', () => {
	it('formats timestamps', () => {
		// No Z suffix: a zoneless timestamp parses as local time, so the
		// rendered day is stable in every timezone the suite runs in.
		expect(formatDate('2026-08-04T14:30:00')).toMatch(/Aug\.? 4, 2026|4 Aug\.? 2026/);
	});

	it('parses date-only strings as local dates (no UTC day shift)', () => {
		// Must always render the 4th regardless of the machine's timezone.
		expect(formatDate('2026-08-04')).toContain('4');
		expect(formatDate('2026-08-04')).toContain('2026');
	});
});

describe('formatDateWithWeekday', () => {
	it('includes the weekday for a date-only string', () => {
		// 2026-08-04 is a Tuesday.
		expect(formatDateWithWeekday('2026-08-04')).toMatch(/Tue/);
	});
});

describe('formatDateTime', () => {
	it('appends the local time', () => {
		expect(formatDateTime('2026-08-04T09:48:00')).toMatch(/9:48/);
	});
});

describe('relativeDayLabel', () => {
	const now = new Date(2026, 7, 7, 12, 0, 0);

	it('labels today and yesterday', () => {
		expect(relativeDayLabel('2026-08-07T09:00:00', now)).toBe('Today');
		expect(relativeDayLabel('2026-08-06T23:59:00', now)).toBe('Yesterday');
	});

	it('drops the year for dates in the current year', () => {
		expect(relativeDayLabel('2026-06-12T00:00:00', now)).not.toContain('2026');
	});

	it('keeps the year for older dates', () => {
		expect(relativeDayLabel('2025-05-22T00:00:00', now)).toContain('2025');
	});
});

describe('formatCalendarDate (UAT #28)', () => {
	it('never shifts a date-only value back a day', () => {
		expect(formatCalendarDate('2030-01-15')).toMatch(/15/);
		expect(formatCalendarDate('2027-09-01')).toMatch(/Sep\.? 1|1 Sep/);
	});

	it('reads a UTC-midnight timestamp as the calendar date it encodes', () => {
		// Stored as 2030-01-15T00:00Z; in Toronto that instant is Jan 14.
		expect(formatCalendarDate('2030-01-15T00:00:00.000Z')).toMatch(/15/);
		expect(formatCalendarDate('2030-01-15T00:00:00.000Z')).not.toMatch(/14/);
	});
});

describe('toDateInputValue', () => {
	it('uses the local calendar day, not the UTC one', () => {
		// 11 pm local on Oct 11 is already Oct 12 in UTC west of Greenwich.
		expect(toDateInputValue(new Date(2027, 9, 11, 23, 30))).toBe('2027-10-11');
	});
});

describe('dates in French (fr-CA)', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it('formats dates, times and relative days in French', () => {
		overwriteGetLocale(() => 'fr');
		expect(formatDate('2026-08-04')).toBe('4 août 2026');
		expect(formatDateTime('2026-08-04T09:48:00')).toBe('4 août 2026, 9 h 48');
		const now = new Date(2026, 7, 7, 12, 0);
		expect(relativeDayLabel('2026-08-07T09:00:00', now)).toBe('Aujourd’hui');
		expect(relativeDayLabel('2026-08-06T23:59:00', now)).toBe('Hier');
	});

	it('keeps calendar dates free of time-zone shifts (UAT #28)', () => {
		overwriteGetLocale(() => 'fr');
		expect(formatCalendarDate('2030-01-15T00:00:00.000Z')).toBe('15 janv. 2030');
	});
});

describe('formatDateTimeIn', () => {
	it('shows an instant in the given zone, not the viewer’s', () => {
		// Toronto's October ends at 03:59:59.999 UTC on November 1st (still EDT).
		const text = formatDateTimeIn('2026-11-01T03:59:59.999Z', 'America/Toronto');
		expect(text).toMatch(/Oct\.? 31, 2026|31 Oct\.? 2026/);
		expect(text).toMatch(/11:59/);
	});
});
