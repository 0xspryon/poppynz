// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import WeekAtAGlance from './WeekAtAGlance.svelte';

const longName = 'Overnight respite care with medication reminders and light housekeeping';

describe('WeekAtAGlance (UAT round 2 #3)', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders one row per day that stacks on phones and a 7-column grid from 640px', () => {
		const app = mount(WeekAtAGlance, {
			target: document.body,
			props: {
				services: [
					{
						serviceId: 'svc-1',
						name: longName,
						listedRateCents: 2500,
						rateCents: 2500,
						currency: 'CAD',
						expectations: '',
						sessions: [{ weekday: 0, startMinutes: 930, endMinutes: 1080 }]
					}
				] as never,
				agreed: true
			}
		});
		flushSync();
		const days = document.querySelectorAll('[data-testid="week-glance-day"]');
		expect(days).toHaveLength(7);
		const grid = days[0]!.parentElement!;
		expect(grid.className).toContain('flex-col');
		expect(grid.className).toContain('sm:grid-cols-7');
		// Long service names truncate, with the full name as the tooltip.
		const legend = [...document.querySelectorAll('li')].find((li) => li.title === longName);
		expect(legend?.className).toContain('truncate');
		expect(document.body.textContent).toContain('Agreed');
		unmount(app);
	});
});
