// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { requestSignInLink } = vi.hoisted(() => ({ requestSignInLink: vi.fn() }));
vi.mock('$lib/api/auth', () => ({ requestSignInLink }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { overwriteGetLocale } from '$lib/paraglide/runtime';
import SignInPage from './+page.svelte';

const settle = async () => {
	for (let i = 0; i < 4; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

afterEach(() => {
	document.body.innerHTML = '';
	overwriteGetLocale(() => 'en');
});

describe('sign-in page in French', () => {
	it('renders its copy in French', () => {
		overwriteGetLocale(() => 'fr');
		const app = mount(SignInPage, { target: document.body });
		flushSync();
		const text = document.body.textContent ?? '';
		expect(document.body.querySelector('h2')?.textContent?.trim()).not.toBe('');
		expect(text).toMatch(/courriel/i);
		expect(text).not.toMatch(/\bemail\b|Sign in|Send/);
		unmount(app);
	});

	it('shows a typed API error in French', async () => {
		overwriteGetLocale(() => 'fr');
		requestSignInLink.mockResolvedValue({
			ok: false,
			error: { code: 'USER_NOT_FOUND', message: 'User not found' }
		});
		const app = mount(SignInPage, { target: document.body });
		flushSync();
		const input = document.body.querySelector('input[type="email"]') as HTMLInputElement;
		input.value = 'kay@example.com';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		document.body.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		await settle();
		const text = document.body.textContent ?? '';
		expect(text).not.toContain('User not found');
		expect(text).toMatch(/compte/i);
		unmount(app);
	});
});
