import { describe, expect, it } from 'vitest';
import { formatEndTime, noticeLastDay } from './contract-sessions';

describe('formatEndTime', () => {
	it('formats an end time like session times', () => {
		expect(formatEndTime(720)).toBe('12:00 pm');
		expect(formatEndTime(1050)).toBe('5:30 pm');
	});

	it('reads 1440 as midnight, not 12:00 am of the same day', () => {
		expect(formatEndTime(1440)).toBe('midnight');
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
