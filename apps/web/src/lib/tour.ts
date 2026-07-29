/** One-shot spotlight walkthroughs (driver.js). A tour keyed in localStorage
 * runs once per browser; finishing or skipping both mark it seen. Steps whose
 * element is missing or hidden at the current viewport (e.g. the desktop
 * filter rail on mobile) are dropped, so one step list serves all layouts.
 * driver.js CSS is imported globally in app.css. */
import { browser } from '$app/environment';
import { driver } from 'driver.js';

export interface TourStep {
	selector: string;
	title: string;
	description: string;
}

const isVisible = (element: Element) => element.getBoundingClientRect().width > 0;

export function startTourOnce(key: string, steps: Array<TourStep>) {
	if (!browser || localStorage.getItem(key) === '1') return;

	const present = steps.filter((step) => {
		const element = document.querySelector(step.selector);
		return element !== null && isVisible(element);
	});
	// A tour with fewer than two anchored steps teaches nothing — skip it and
	// leave the key unset so a later, fully rendered visit can run it.
	if (present.length < 2) return;

	driver({
		showProgress: true,
		overlayOpacity: 0.55,
		stagePadding: 6,
		nextBtnText: 'Next',
		prevBtnText: 'Back',
		doneBtnText: 'Got it',
		onDestroyed: () => localStorage.setItem(key, '1'),
		steps: present.map((step) => ({
			element: step.selector,
			popover: { title: step.title, description: step.description }
		}))
	}).drive();
}
