// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/admin-approvals', () => ({
	actOnVouch: vi.fn(),
	saveGeneralRemarks: vi.fn()
}));

import { formatDate, formatDateTime } from '$lib/date';
import GeneralRemarksCard from './GeneralRemarksCard.svelte';
import VouchesCard from './VouchesCard.svelte';

/** The admin detail page prints every date with the shared en-CA helpers;
 * these cards used the browser's locale, so a German or French-Canadian
 * browser showed "2. Okt. 2026" / "2.10.2026, 00:11:51" beside "Oct 2, 2026". */
describe('admin vouch cards format dates like the rest of the admin page', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	});

	// Simulate a browser whose default locale is not English: any call that
	// leaves the locale to the browser gets German output.
	const useGermanBrowserLocale = () => {
		const toLocaleDateString = Date.prototype.toLocaleDateString;
		const toLocaleString = Date.prototype.toLocaleString;
		const toLocaleTimeString = Date.prototype.toLocaleTimeString;
		vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
			this: Date,
			locales,
			options
		) {
			return toLocaleDateString.call(this, locales ?? 'de-DE', options);
		});
		vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
			this: Date,
			locales,
			options
		) {
			return toLocaleString.call(this, locales ?? 'de-DE', options);
		});
		vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (
			this: Date,
			locales,
			options
		) {
			return toLocaleTimeString.call(this, locales ?? 'de-DE', options);
		});
	};

	it('prints "Last saved" in en-CA', () => {
		useGermanBrowserLocale();
		const app = mount(GeneralRemarksCard, {
			target: document.body,
			props: {
				requestId: 'request-1',
				remarks: 'Called her',
				updatedAt: '2026-10-02T12:00:00.000Z',
				onchanged: async () => {}
			}
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain(`Last saved ${formatDateTime('2026-10-02T12:00:00.000Z')}`);
	});

	it('prints the attestation date in en-CA', () => {
		useGermanBrowserLocale();
		const app = mount(VouchesCard, {
			target: document.body,
			props: {
				vouches: [
					{
						id: 'vouch-1',
						voucher: {
							userId: 'voucher-1',
							name: 'Fiona Family',
							email: 'fiona@example.com',
							role: 'family',
							inGoodStanding: true
						},
						relationship: 'Neighbour',
						status: 'accepted',
						counts: true,
						answers: {
							howKnow: 'Neighbour',
							howLong: '2 years',
							wouldTrust: 'yes',
							hasConcerns: false,
							concernsDetail: null,
							wouldHire: 'yes',
							anythingElse: null
						},
						attestedAt: '2026-10-02T12:00:00.000Z',
						submittedIp: '203.0.113.7',
						requestedAt: '2026-10-01T12:00:00.000Z',
						decidedAt: '2026-10-02T12:00:00.000Z',
						adminReason: null
					}
				],
				onchanged: async () => {}
			}
		});
		flushSync();
		const text = document.body.textContent ?? '';
		unmount(app);
		expect(text).toContain(`Attested ${formatDate('2026-10-02T12:00:00.000Z')} `);
	});
});
