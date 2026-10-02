// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContractTermsEditor from './ContractTermsEditor.svelte';

const initial = {
	versionId: 'version-1',
	version: 1,
	status: 'draft',
	proposedByMe: true,
	services: [
		{
			serviceId: 'service-1',
			name: 'Childcare',
			listedRateCents: 2500,
			rateCents: 2600,
			currency: 'CAD',
			sessions: [{ weekday: 4, startMinutes: 540, endMinutes: 1020 }],
			expectations: ''
		}
	],
	startsOn: '2026-10-05',
	endsOn: '2026-12-11',
	endsAtMinutes: null,
	weeklyEstimateCents: 20800,
	currency: 'CAD',
	sentAt: null,
	expiresAt: null,
	decidedAt: null,
	declineReason: null
};

const baseProps = {
	providerServices: [{ id: 'service-1', name: 'Childcare', hourlyRateCents: 2500 }],
	initial: initial as never,
	listingLabel: "Maria's listing",
	counterpartFirstName: 'Maria'
};

const sendButton = () =>
	[...document.querySelectorAll('button')].find((button) =>
		button.textContent?.includes('Send to Maria')
	) as HTMLButtonElement;

describe('ContractTermsEditor', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('limits the start date to the earliest allowed day', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend: vi.fn(), earliestStartsOn: '2026-09-25' }
		});
		flushSync();
		const min = document.querySelector('#contract-starts')?.getAttribute('min');
		unmount(app);
		expect(min).toBe('2026-09-25');
	});

	it('sends the chosen last-day end time with the end date', () => {
		const onsend = vi.fn();
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend }
		});
		flushSync();
		const select = document.querySelector('#contract-ends-at') as HTMLSelectElement;
		select.value = '720';
		select.dispatchEvent(new Event('change'));
		flushSync();
		sendButton().click();
		flushSync();
		unmount(app);
		expect(onsend).toHaveBeenCalledWith(
			expect.objectContaining({ endsOn: '2026-12-11', endsAtMinutes: 720 })
		);
	});

	it('forgets the end time when the end date is cleared through the date input', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: { ...baseProps, onsend: vi.fn() }
		});
		flushSync();
		const select = document.querySelector('#contract-ends-at') as HTMLSelectElement;
		select.value = '720';
		select.dispatchEvent(new Event('change'));
		flushSync();

		const endsInput = document.querySelector('#contract-ends') as HTMLInputElement;
		endsInput.value = '';
		endsInput.dispatchEvent(new Event('input'));
		flushSync();
		endsInput.value = '2026-12-18';
		endsInput.dispatchEvent(new Event('input'));
		flushSync();

		const reopened = document.querySelector('#contract-ends-at') as HTMLSelectElement;
		const shown = reopened.selectedOptions[0]?.textContent?.trim();
		unmount(app);
		expect(shown).toBe('Full scheduled day');
	});

	it('blocks sending and points to the profile while the family has no address', () => {
		const app = mount(ContractTermsEditor, {
			target: document.body,
			props: {
				...baseProps,
				onsend: vi.fn(),
				locationMissing: true,
				profileHref: '/family/profile' as never
			}
		});
		flushSync();
		const disabled = sendButton().disabled;
		const link = document.querySelector('a[href="/family/profile"]')?.textContent;
		unmount(app);
		expect(disabled).toBe(true);
		expect(link).toContain('Add your address');
	});
});
