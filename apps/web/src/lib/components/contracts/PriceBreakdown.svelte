<script lang="ts">
	/** The weekly price of a set of terms for the viewer's side (piece 3),
	 * computed by the server with the one rounding rule billing uses: the
	 * family sees the Poppynz service fee and its tax added; the helper sees
	 * the commission and its tax deducted. Billing itself charges each 3-day
	 * cycle's real session hours, so this is per week of the agreed pattern. */
	import type { ContractPricing } from '$lib/api/contracts';
	import { formatNumber } from '$lib/locale';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { localizeTaxLabel } from '$lib/tax-label';

	interface Props {
		pricing: ContractPricing;
		/** Whose profile a missing province belongs to, from the viewer's view. */
		viewerSide: 'family' | 'provider';
	}

	let { pricing, viewerSide }: Props = $props();

	const percent = (bps: number) =>
		formatNumber(bps / 10_000, { style: 'percent', maximumFractionDigits: 3 });

	const unavailableMessage = $derived.by(() => {
		if (pricing.available) return '';
		if (pricing.reason === 'tax_configuration_incomplete') {
			return m.contracts_price_unavailable_tax();
		}
		const mine =
			(pricing.missingProvinceOf === 'family' && viewerSide === 'family') ||
			(pricing.missingProvinceOf === 'helper' && viewerSide === 'provider');
		return mine
			? m.contracts_price_add_province()
			: pricing.missingProvinceOf === 'family'
				? m.contracts_price_family_no_province()
				: m.contracts_price_helper_no_province();
	});
</script>

<div
	class="rounded-lg border border-base-300 bg-base-200/40 px-4 py-3"
	data-testid="price-breakdown"
>
	<h4 class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{m.contracts_price_heading()}
	</h4>
	{#if !pricing.available}
		<p class="text-[12.5px] leading-relaxed text-base-content-muted">{unavailableMessage}</p>
	{:else}
		<dl class="space-y-1 text-[13px]">
			<div class="flex justify-between">
				<dt class="text-base-content-muted">{m.contracts_price_care()}</dt>
				<dd class="tabular-nums text-base-content">{formatMoney(pricing.serviceCents)}</dd>
			</div>
			{#each pricing.serviceTaxLines as line (line.label)}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">{localizeTaxLabel(line.label)}</dt>
					<dd class="tabular-nums text-base-content">{formatMoney(line.taxCents)}</dd>
				</div>
			{/each}
			{#if pricing.side === 'family'}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">
						{m.contracts_price_service_fee({ percent: percent(pricing.feeBps) })}
					</dt>
					<dd class="tabular-nums text-base-content">+{formatMoney(pricing.feeCents)}</dd>
				</div>
				{#each pricing.feeTaxLines as line (line.label)}
					<div class="flex justify-between">
						<dt class="text-base-content-muted">
							{m.contracts_price_tax_on_fee({ tax: localizeTaxLabel(line.label) })}
						</dt>
						<dd class="tabular-nums text-base-content">+{formatMoney(line.taxCents)}</dd>
					</div>
				{/each}
				<div class="flex justify-between border-t border-base-300 pt-1 font-semibold">
					<dt class="text-base-content">{m.contracts_price_you_pay()}</dt>
					<dd class="tabular-nums text-secondary">{formatMoney(pricing.totalCents)}</dd>
				</div>
			{:else}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">
						{m.contracts_price_commission({ percent: percent(pricing.commissionBps) })}
					</dt>
					<dd class="tabular-nums text-base-content">
						−{formatMoney(pricing.commissionCents)}
					</dd>
				</div>
				{#each pricing.commissionTaxLines as line (line.label)}
					<div class="flex justify-between">
						<dt class="text-base-content-muted">
							{m.contracts_price_tax_on_commission({ tax: localizeTaxLabel(line.label) })}
						</dt>
						<dd class="tabular-nums text-base-content">−{formatMoney(line.taxCents)}</dd>
					</div>
				{/each}
				<div class="flex justify-between border-t border-base-300 pt-1 font-semibold">
					<dt class="text-base-content">{m.contracts_price_you_receive()}</dt>
					<dd class="tabular-nums text-secondary">{formatMoney(pricing.shareCents)}</dd>
				</div>
			{/if}
		</dl>
		<p class="mt-2 text-[11px] leading-relaxed text-outline">
			{#if pricing.side === 'family'}
				{m.contracts_price_family_note()}
			{:else}
				{m.contracts_price_provider_note()}
			{/if}
		</p>
	{/if}
</div>
