// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PayoutsReminder from './PayoutsReminder.svelte';

describe('PayoutsReminder', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('reminds without blocking and links to Payouts', () => {
		const app = mount(PayoutsReminder, { target: document.body });
		flushSync();
		const bold = document.querySelector('strong')?.textContent;
		const text = document.body.textContent?.replace(/\s+/g, ' ').trim();
		const link = document.querySelector('a')?.getAttribute('href');
		unmount(app);
		expect(bold).toBe("You'll need a payout account to collect your earnings.");
		expect(text).toBe(
			"You'll need a payout account to collect your earnings. Set it up now, or later — you'll be asked again before your first payment."
		);
		expect(link).toBe('/service-provider/payouts');
	});
});
