import { describe, expect, it } from 'vitest';
import { formatLeadHours, formatLeadMinutes } from './lead-time';

describe('lead-time copy (UAT round 2 #6, #10)', () => {
	it('words whole days as days and the rest as hours', () => {
		expect(formatLeadHours(24)).toBe('1 day');
		expect(formatLeadHours(48)).toBe('2 days');
		expect(formatLeadHours(1)).toBe('1 hour');
		expect(formatLeadHours(36)).toBe('36 hours');
	});

	it('words the minimum lead in hours or minutes', () => {
		expect(formatLeadMinutes(120)).toBe('2 hours');
		expect(formatLeadMinutes(90)).toBe('90 minutes');
		expect(formatLeadMinutes(1440)).toBe('1 day');
	});
});
