import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDateWithWeekday, relativeDayLabel } from './date';

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
