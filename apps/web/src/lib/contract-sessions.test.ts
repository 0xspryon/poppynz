import { describe, expect, it } from 'vitest';
import { formatEndTime } from './contract-sessions';

describe('formatEndTime', () => {
	it('formats an end time like session times', () => {
		expect(formatEndTime(720)).toBe('12:00 pm');
		expect(formatEndTime(1050)).toBe('5:30 pm');
	});

	it('reads 1440 as midnight, not 12:00 am of the same day', () => {
		expect(formatEndTime(1440)).toBe('midnight');
	});
});
