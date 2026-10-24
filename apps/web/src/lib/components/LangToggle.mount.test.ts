// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { switchLocale } = vi.hoisted(() => ({ switchLocale: vi.fn(async () => undefined) }));
vi.mock('$lib/locale-sync', () => ({ switchLocale }));

import { overwriteGetLocale } from '$lib/paraglide/runtime';
import LangToggle from './LangToggle.svelte';

const buttons = () => [...document.body.querySelectorAll('button')];

afterEach(() => {
	document.body.innerHTML = '';
	overwriteGetLocale(() => 'en');
	vi.clearAllMocks();
});

describe('LangToggle', () => {
	it('offers EN and FR only, with the active one pressed', () => {
		overwriteGetLocale(() => 'en');
		const app = mount(LangToggle, { target: document.body });
		flushSync();
		expect(buttons().map((button) => button.textContent?.trim())).toEqual(['en', 'fr']);
		expect(buttons().map((button) => button.getAttribute('aria-pressed'))).toEqual([
			'true',
			'false'
		]);
		expect(document.body.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
			'Language'
		);
		unmount(app);
	});

	it('switches to French when FR is clicked', () => {
		overwriteGetLocale(() => 'en');
		const app = mount(LangToggle, { target: document.body });
		flushSync();
		buttons()[1]!.click();
		expect(switchLocale).toHaveBeenCalledWith('fr');
		unmount(app);
	});

	it('does not re-switch to the active locale, and labels itself in French', () => {
		overwriteGetLocale(() => 'fr');
		const app = mount(LangToggle, { target: document.body });
		flushSync();
		expect(document.body.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
			'Langue'
		);
		buttons()[1]!.click();
		expect(switchLocale).not.toHaveBeenCalled();
		buttons()[0]!.click();
		expect(switchLocale).toHaveBeenCalledWith('en');
		unmount(app);
	});
});
