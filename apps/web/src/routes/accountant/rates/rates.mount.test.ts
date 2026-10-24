// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getTaxConfig, supersedeTaxRate, toastSuccess, toastError } = vi.hoisted(() => ({
	getTaxConfig: vi.fn(),
	supersedeTaxRate: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn()
}));

vi.mock('$lib/api/tax', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/tax')>()),
	getTaxConfig,
	supersedeTaxRate
}));
vi.mock('$lib/toast.svelte', () => ({
	toast: { success: toastSuccess, error: toastError, info: vi.fn() }
}));

import RatesPage from './+page.svelte';

const config = {
	ok: true,
	data: {
		today: '2026-10-24',
		jurisdictions: [
			{ code: 'CA', name: 'Canada (federal)', kind: 'federal' },
			{ code: 'ON', name: 'Ontario', kind: 'province' }
		],
		supplyTypes: [],
		rates: [
			{
				id: 'rate-on',
				jurisdictionCode: 'ON',
				component: 'hst',
				rateMillipercent: 13000,
				effectiveFrom: '2010-07-01',
				effectiveTo: null,
				standing: 'in_force'
			}
		],
		treatments: [],
		registrations: []
	}
};

const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await new Promise((resolve) => setTimeout(resolve));
		flushSync();
	}
};

const button = (label: string) =>
	[...document.querySelectorAll('button')].find((candidate) =>
		candidate.textContent?.trim().startsWith(label)
	) as HTMLButtonElement | undefined;

const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	element.value = value;
	element.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
};

describe('accountant rates page', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '';
	});

	it('lists the rates and says frozen charges never change', async () => {
		getTaxConfig.mockResolvedValue(config);
		const app = mount(RatesPage, { target: document.body });
		await settle();
		const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
		unmount(app);

		expect(text).toContain('13%');
		expect(text).toContain('In force');
		expect(text).toContain('Charges already made keep the tax lines frozen on them');
	});

	it('saves only after a reason and a review step, past dates only once ticked', async () => {
		getTaxConfig.mockResolvedValue(config);
		supersedeTaxRate.mockResolvedValue({ ok: true, data: { rate: {} } });
		const app = mount(RatesPage, { target: document.body });
		await settle();
		button('Change')?.click();
		flushSync();

		const dialog = document.querySelector('[role="dialog"]')!;
		const [rateInput] = [
			...dialog.querySelectorAll('input:not([type])')
		] as Array<HTMLInputElement>;
		const [fromInput] = [
			...dialog.querySelectorAll('input[type="date"]')
		] as Array<HTMLInputElement>;
		type(rateInput!, '13.5');
		type(fromInput!, '2026-10-01');
		const reviewWithoutReason = button('Review change')?.disabled;
		type(dialog.querySelector('textarea')!, 'Corrected from the budget');
		button('Review change')?.click();
		flushSync();
		const saveBeforeTick = button('Save change')?.disabled;
		const confirmPast = document.querySelector<HTMLInputElement>(
			'[role="dialog"] input[type="checkbox"]'
		)!;
		confirmPast.click();
		flushSync();
		button('Save change')?.click();
		await settle();
		unmount(app);

		expect(reviewWithoutReason).toBe(true);
		expect(saveBeforeTick).toBe(true);
		expect(supersedeTaxRate).toHaveBeenCalledWith({
			jurisdictionCode: 'ON',
			component: 'hst',
			rateMillipercent: 13500,
			effectiveFrom: '2026-10-01',
			effectiveTo: null,
			reason: 'Corrected from the budget',
			confirmPastEffectiveDate: true
		});
		expect(toastSuccess).toHaveBeenCalledOnce();
	});

	it('shows a refused change as a toast', async () => {
		getTaxConfig.mockResolvedValue(config);
		supersedeTaxRate.mockResolvedValue({
			ok: false,
			error: { code: 'TAX_CONFIG_OVERLAP', message: 'Another value already starts later.' }
		});
		const app = mount(RatesPage, { target: document.body });
		await settle();
		button('Change')?.click();
		flushSync();
		const dialog = document.querySelector('[role="dialog"]')!;
		type(dialog.querySelector('textarea')!, 'Fix');
		button('Review change')?.click();
		flushSync();
		button('Save change')?.click();
		await settle();
		unmount(app);

		expect(toastError).toHaveBeenCalledWith('Another value already starts later.', {
			title: 'Rate not saved'
		});
	});
});
