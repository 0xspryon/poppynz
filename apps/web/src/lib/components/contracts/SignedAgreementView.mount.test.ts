// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSignedAgreement } = vi.hoisted(() => ({ getSignedAgreement: vi.fn() }));
vi.mock('$lib/api/agreements', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/agreements')>()),
	getSignedAgreement
}));
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false,
	building: false,
	version: 'test'
}));

import SignedAgreementView from './SignedAgreementView.svelte';

const signature = (overrides: Record<string, unknown> = {}) => ({
	id: 'sig-family',
	side: 'family',
	signerName: 'Priya Tester',
	contractVersion: 2,
	templateVersion: 1,
	locale: 'en',
	sha256: 'b'.repeat(64),
	cancellationPolicyVersion: 3,
	signedAt: '2026-10-22T15:00:00.000Z',
	voidedAt: null,
	counts: true,
	content: 'The text Priya signed.',
	...overrides
});

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

describe('SignedAgreementView', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('shows who signed which version, that both signed the same text, and the text', async () => {
		getSignedAgreement.mockResolvedValue({
			ok: true,
			data: {
				agreement: {
					contractId: 'c-1',
					title: 'Service Agreement',
					contractVersion: 2,
					signatures: [
						signature({ id: 'sig-helper', side: 'helper', signerName: 'Maria Tester' }),
						signature(),
						signature({
							id: 'sig-old',
							counts: false,
							voidedAt: '2026-10-21T00:00:00.000Z',
							sha256: 'c'.repeat(64)
						})
					]
				}
			}
		});
		const app = mount(SignedAgreementView, { target: document.body, props: { contractId: 'c-1' } });
		await settle();
		const text = document.body.textContent ?? '';
		unmount(app);

		expect(text).toContain('Maria Tester');
		expect(text).toContain('Priya Tester');
		expect(text).toContain('Agreement version 1 · terms version 2 · English · text bbbbbbbbbbbb');
		expect(text).toContain('Cancellation policy: Terms of Service version 3');
		expect(text).toContain('Both parties signed the identical text.');
		expect(text).toContain('Earlier signatures (1)');
		expect(text).toContain('No longer counts');
		expect(text).toContain('The text Priya signed.');
	});

	it('says when no one has signed the agreement for these terms', async () => {
		getSignedAgreement.mockResolvedValue({
			ok: true,
			data: { agreement: { contractId: 'c-1', title: null, contractVersion: 1, signatures: [] } }
		});
		const app = mount(SignedAgreementView, { target: document.body, props: { contractId: 'c-1' } });
		await settle();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain('No one has signed the written agreement for these terms yet.');
	});
});
