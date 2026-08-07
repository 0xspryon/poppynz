<script lang="ts">
	/** Read-only terms rendering (16f right-hand card): service line items with
	 * rate math, schedule/start grid and the weekly estimate. `dimmed` is the
	 * declined-terms treatment (16j) — visible but clearly out of force. */
	import type { ContractTerms } from '$lib/api/contracts';
	import { centsToDollars } from '$lib/money';
	import { formatDateWithWeekday } from '$lib/date';

	interface Props {
		terms: ContractTerms;
		dimmed?: boolean;
		heading?: string;
	}

	let { terms, dimmed = false, heading = 'Services & rates' }: Props = $props();

	const lineTotal = (rateCents: number, hoursPerWeek: number) =>
		centsToDollars(Math.round(rateCents * hoursPerWeek));
</script>

<section
	class={['rounded-xl border border-card-border bg-base-100 px-5 py-4', dimmed ? 'opacity-70' : '']}
>
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{heading}
	</h3>
	<ul>
		{#each terms.services as service (service.serviceId)}
			<li class="border-b border-base-300 py-2.5 last:border-b-0">
				<div class="text-[13.5px] font-semibold text-base-content">{service.name}</div>
				<div class="mt-0.5 text-xs text-base-content-muted">
					{service.hoursPerWeek} hrs/wk × ${centsToDollars(service.rateCents)}/hr =
					<strong class="text-secondary">
						${lineTotal(service.rateCents, service.hoursPerWeek)}/wk
					</strong>
					{#if service.rateCents > service.listedRateCents}
						<span class="text-outline"> · listed ${centsToDollars(service.listedRateCents)}</span>
					{/if}
				</div>
				{#if service.expectations}
					<p class="mt-1 text-[12.5px] leading-relaxed text-base-content-muted">
						“{service.expectations}”
					</p>
				{/if}
			</li>
		{/each}
	</ul>

	{#if terms.schedule || terms.startsOn}
		<div
			class="mt-1 grid grid-cols-[90px_1fr] items-center gap-x-4 gap-y-2 border-t border-base-300
				pt-3 text-[13px]"
		>
			{#if terms.schedule}
				<span class="text-base-content-muted">Schedule</span>
				<span class="font-medium text-base-content">{terms.schedule}</span>
			{/if}
			{#if terms.startsOn}
				<span class="text-base-content-muted">Starts</span>
				<span class="font-medium text-base-content">{formatDateWithWeekday(terms.startsOn)}</span>
			{/if}
		</div>
	{/if}

	<div class="mt-3 flex items-center justify-between border-t border-base-300 pt-3">
		<span class="text-[12.5px] text-base-content-muted">Weekly estimate</span>
		<span class="font-display text-base font-bold text-secondary">
			${centsToDollars(terms.weeklyEstimateCents)}
		</span>
	</div>
</section>
