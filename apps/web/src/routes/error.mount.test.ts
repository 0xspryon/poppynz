// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { status: 404 } }));

import { overwriteGetLocale } from '$lib/paraglide/runtime';
import ErrorPage from './+error.svelte';

afterEach(() => {
	document.body.innerHTML = '';
	overwriteGetLocale(() => 'en');
});

const render = (locale: 'en' | 'fr') => {
	overwriteGetLocale(() => locale);
	const app = mount(ErrorPage, { target: document.body });
	flushSync();
	const result = {
		heading: document.body.querySelector('h1')?.textContent?.trim(),
		status: document.body.querySelector('p')?.textContent?.trim(),
		link: document.body.querySelector('a')?.textContent?.trim()
	};
	unmount(app);
	return result;
};

describe('error page', () => {
	it('renders the not-found page in French', () => {
		expect(render('fr')).toEqual({
			heading: 'Page introuvable',
			status: 'Erreur 404',
			link: 'Aller à Poppynz'
		});
	});

	it('renders the not-found page in English', () => {
		expect(render('en')).toEqual({
			heading: 'Page not found',
			status: 'Error 404',
			link: 'Go to Poppynz'
		});
	});
});
