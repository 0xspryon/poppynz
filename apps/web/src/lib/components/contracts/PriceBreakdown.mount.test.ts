// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PriceBreakdown from './PriceBreakdown.svelte';

const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

const render = (props: Record<string, unknown>) => {
	const app = mount(PriceBreakdown, { target: document.body, props: props as never });
	flushSync();
	return app;
};

describe('PriceBreakdown', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('shows the family the fee and its tax added on top', () => {
		const app = render({
			viewerSide: 'family',
			pricing: {
				available: true,
				side: 'family',
				period: 'week',
				serviceCents: 10400,
				serviceTaxLines: [],
				feeBps: 500,
				feeCents: 520,
				feeTaxLines: [{ label: 'GST (MB) 5%', taxCents: 26 }],
				totalCents: 10946
			}
		});
		expect(text()).toContain('Care $104.00');
		expect(text()).toContain('Poppynz service fee (5%) +$5.20');
		expect(text()).toContain('GST (MB) 5% on the fee +$0.26');
		expect(text()).toContain('You pay $109.46');
		unmount(app);
	});

	it('shows the helper the commission and its tax deducted', () => {
		const app = render({
			viewerSide: 'provider',
			pricing: {
				available: true,
				side: 'provider',
				period: 'week',
				serviceCents: 10400,
				serviceTaxLines: [],
				commissionBps: 1500,
				commissionCents: 1560,
				commissionTaxLines: [{ label: 'HST (ON) 13%', taxCents: 203 }],
				shareCents: 8637
			}
		});
		expect(text()).toContain('Poppynz commission (15%) −$15.60');
		expect(text()).toContain('HST (ON) 13% on the commission −$2.03');
		expect(text()).toContain('You receive $86.37');
		unmount(app);
	});

	it('explains whose province is missing instead of showing a price', () => {
		const app = render({
			viewerSide: 'provider',
			pricing: { available: false, reason: 'tax_province_required', missingProvinceOf: 'helper' }
		});
		expect(text()).toContain('Add your province to your profile address');
		expect(text()).not.toContain('You receive');
		unmount(app);
	});
});
