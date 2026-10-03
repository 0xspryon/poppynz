// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders extra content under the body', () => {
		const children = createRawSnippet(() => ({
			render: () => '<p data-testid="extra">Extra note</p>'
		}));
		const app = mount(ConfirmDialog, {
			target: document.body,
			props: {
				open: true,
				title: 'Accept & sign this contract?',
				body: 'Signing activates the contract.',
				onconfirm: vi.fn(),
				oncancel: vi.fn(),
				children
			}
		});
		flushSync();
		const extra = document.querySelector('[data-testid="extra"]')?.textContent;
		unmount(app);
		expect(extra).toBe('Extra note');
	});
});
