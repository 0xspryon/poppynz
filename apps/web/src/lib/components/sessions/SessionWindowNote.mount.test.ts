// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import SessionWindowNote from './SessionWindowNote.svelte';

const text = () =>
	document
		.querySelector('[data-testid="session-window-note"]')
		?.textContent?.replace(/\s+/g, ' ')
		.trim();

afterEach(() => {
	document.body.innerHTML = '';
	overwriteGetLocale(() => 'en');
});

describe('SessionWindowNote (spec §3)', () => {
	it('explains the window with the configured numbers in English', () => {
		const app = mount(SessionWindowNote, {
			target: document.body,
			props: { windowDays: 14, cancellationNoticeHours: 24 }
		});
		flushSync();
		expect(text()).toBe(
			'Sessions appear 14 days ahead. To take a day off or a holiday further out, come back when those dates appear. Cancelling at least 24 hours before a session is free for the family.'
		);
		unmount(app);
	});

	it('follows other settings — never a hard-coded 14', () => {
		const app = mount(SessionWindowNote, {
			target: document.body,
			props: { windowDays: 21, cancellationNoticeHours: 48 }
		});
		flushSync();
		expect(text()).toContain('Sessions appear 21 days ahead.');
		expect(text()).toContain('at least 48 hours before');
		unmount(app);
	});

	it('explains the window in French', () => {
		overwriteGetLocale(() => 'fr');
		const app = mount(SessionWindowNote, {
			target: document.body,
			props: { windowDays: 14, cancellationNoticeHours: 24 }
		});
		flushSync();
		expect(text()).toBe(
			'Les séances apparaissent 14 jours à l’avance. Pour prendre congé ou des vacances plus tard, revenez lorsque ces dates apparaîtront. Annuler au moins 24 heures avant une séance est gratuit pour la famille.'
		);
		unmount(app);
	});
});
