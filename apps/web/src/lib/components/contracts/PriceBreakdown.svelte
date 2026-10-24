<script lang="ts">
	/** The weekly price of a set of terms for the viewer's side (piece 3),
	 * computed by the server with the one rounding rule billing uses: the
	 * family sees the Poppynz service fee and its tax added; the helper sees
	 * the commission and its tax deducted. Billing itself charges each 3-day
	 * cycle's real session hours, so this is per week of the agreed pattern. */
	import type { ContractPricing } from '$lib/api/contracts';
	import { centsToDollars } from '$lib/money';

	interface Props {
		pricing: ContractPricing;
		/** Whose profile a missing province belongs to, from the viewer's view. */
		viewerSide: 'family' | 'provider';
	}

	let { pricing, viewerSide }: Props = $props();

	const percent = (bps: number) => `${bps / 100}%`;

	const unavailableMessage = $derived.by(() => {
		if (pricing.available) return '';
		if (pricing.reason === 'tax_configuration_incomplete') {
			return "We can't price these terms right now. Please try again later.";
		}
		const mine =
			(pricing.missingProvinceOf === 'family' && viewerSide === 'family') ||
			(pricing.missingProvinceOf === 'helper' && viewerSide === 'provider');
		return mine
			? 'Add your province to your profile address to see the price — sales tax depends on it.'
			: pricing.missingProvinceOf === 'family'
				? "The family's address has no province yet, so the price can't be shown."
				: "The helper's address has no province yet, so the price can't be shown.";
	});
</script>

<div
	class="rounded-lg border border-base-300 bg-base-200/40 px-4 py-3"
	data-testid="price-breakdown"
>
	<h4 class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		Price per week
	</h4>
	{#if !pricing.available}
		<p class="text-[12.5px] leading-relaxed text-base-content-muted">{unavailableMessage}</p>
	{:else}
		<dl class="space-y-1 text-[13px]">
			<div class="flex justify-between">
				<dt class="text-base-content-muted">Care</dt>
				<dd class="tabular-nums text-base-content">${centsToDollars(pricing.serviceCents)}</dd>
			</div>
			{#each pricing.serviceTaxLines as line (line.label)}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">{line.label}</dt>
					<dd class="tabular-nums text-base-content">${centsToDollars(line.taxCents)}</dd>
				</div>
			{/each}
			{#if pricing.side === 'family'}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">Poppynz service fee ({percent(pricing.feeBps)})</dt>
					<dd class="tabular-nums text-base-content">+${centsToDollars(pricing.feeCents)}</dd>
				</div>
				{#each pricing.feeTaxLines as line (line.label)}
					<div class="flex justify-between">
						<dt class="text-base-content-muted">{line.label} on the fee</dt>
						<dd class="tabular-nums text-base-content">+${centsToDollars(line.taxCents)}</dd>
					</div>
				{/each}
				<div class="flex justify-between border-t border-base-300 pt-1 font-semibold">
					<dt class="text-base-content">You pay</dt>
					<dd class="tabular-nums text-secondary">${centsToDollars(pricing.totalCents)}</dd>
				</div>
			{:else}
				<div class="flex justify-between">
					<dt class="text-base-content-muted">
						Poppynz commission ({percent(pricing.commissionBps)})
					</dt>
					<dd class="tabular-nums text-base-content">
						−${centsToDollars(pricing.commissionCents)}
					</dd>
				</div>
				{#each pricing.commissionTaxLines as line (line.label)}
					<div class="flex justify-between">
						<dt class="text-base-content-muted">{line.label} on the commission</dt>
						<dd class="tabular-nums text-base-content">−${centsToDollars(line.taxCents)}</dd>
					</div>
				{/each}
				<div class="flex justify-between border-t border-base-300 pt-1 font-semibold">
					<dt class="text-base-content">You receive</dt>
					<dd class="tabular-nums text-secondary">${centsToDollars(pricing.shareCents)}</dd>
				</div>
			{/if}
		</dl>
		<p class="mt-2 text-[11px] leading-relaxed text-outline">
			{#if pricing.side === 'family'}
				Billed in 3-day cycles for the hours actually scheduled: each cycle is held on your card 2
				days before it starts and charged before care begins.
			{:else}
				Each 3-day cycle is charged to the family before it starts; you are paid for its sessions
				after it ends.
			{/if}
		</p>
	{/if}
</div>
