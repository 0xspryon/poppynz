// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getAgreementToSign } = vi.hoisted(() => ({ getAgreementToSign: vi.fn() }));
vi.mock('$lib/api/agreements', () => ({ getAgreementToSign }));
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

import AgreementSignDialog from './AgreementSignDialog.svelte';

const agreement = (overrides: Record<string, unknown> = {}) => ({
	side: 'family',
	contractVersion: 1,
	documentId: 'agreement-doc',
	title: 'Service Agreement',
	versionId: 'agreement-v1-en',
	version: 1,
	locale: 'en',
	fallback: false,
	checkboxLabel: 'I have read and agree to this Service Agreement.',
	content: '# Service Agreement\n\nBetween Priya Tester and Maria Tester.',
	sha256: 'a'.repeat(64),
	cancellationPolicyVersion: 3,
	...overrides
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.includes(label)
	) as HTMLButtonElement;

const checkbox = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;

const open = (onsign = vi.fn(async () => 'signed' as const), action: 'send' | 'accept' = 'send') =>
	mount(AgreementSignDialog, {
		target: document.body,
		props: {
			open: true,
			contractId: 'c-1',
			action,
			counterpartName: 'Maria',
			onsign,
			oncancel: vi.fn()
		}
	});

describe('AgreementSignDialog', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('shows the rendered agreement and signs only after the explicit tick', async () => {
		getAgreementToSign.mockResolvedValue({ ok: true, data: { agreement: agreement() } });
		const onsign = vi.fn(async () => 'signed' as const);
		const app = open(onsign);
		await settle();

		expect(document.body.textContent).toContain('Between Priya Tester and Maria Tester.');
		expect(document.body.textContent).toContain('Agreement version 1');
		expect(button('Sign & send').disabled).toBe(true);

		checkbox().click();
		flushSync();
		expect(button('Sign & send').disabled).toBe(false);
		button('Sign & send').click();
		await settle();
		unmount(app);

		expect(onsign).toHaveBeenCalledWith({ versionId: 'agreement-v1-en', sha256: 'a'.repeat(64) });
	});

	it('reloads the text and asks for a fresh tick when it changed meanwhile', async () => {
		getAgreementToSign
			.mockResolvedValueOnce({ ok: true, data: { agreement: agreement() } })
			.mockResolvedValueOnce({
				ok: true,
				data: { agreement: agreement({ version: 2, versionId: 'v2', content: 'Updated text.' }) }
			});
		const app = open(
			vi.fn(async () => 'changed' as const),
			'accept'
		);
		await settle();
		checkbox().click();
		flushSync();
		button('Accept & sign').click();
		await settle();

		expect(getAgreementToSign).toHaveBeenCalledTimes(2);
		expect(document.body.textContent).toContain('Updated text.');
		expect(checkbox().checked).toBe(false);
		expect(button('Accept & sign').disabled).toBe(true);
		unmount(app);
	});

	it('says the English text governs, with the tick in the reader’s language, when untranslated', async () => {
		getAgreementToSign.mockResolvedValue({
			ok: true,
			data: { agreement: agreement({ fallback: true, checkboxLabel: 'English-only label' }) }
		});
		const app = open();
		await settle();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain('French version coming soon');
		expect(text).not.toContain('English-only label');
	});

	it('offers a retry instead of a sign button that could never work when loading fails', async () => {
		getAgreementToSign.mockResolvedValue({
			ok: false,
			error: { code: 'AGREEMENT_UNAVAILABLE', message: 'x' }
		});
		const app = open();
		await settle();
		expect(button('Try again')).toBeTruthy();
		expect(button('Sign & send').disabled).toBe(true);
		unmount(app);
	});
});
