<script lang="ts">
	/** Read-only terms rendering (Flow F): service line items with per-session
	 * rows and derived rate math, the starts/ends grid and the weekly estimate.
	 * `dimmed` is the declined-terms treatment (16j) — visible but clearly out
	 * of force. */
	import type { ContractTerms } from '$lib/api/contracts';
	import {
		formatSessionRange,
		minutesToHours,
		serviceWeeklyCents,
		sessionMinutes,
		weeklyMinutes,
		WEEKDAY_LABELS
	} from '$lib/contract-sessions';
	import { centsToDollars } from '$lib/money';
	import { formatDateWithWeekday } from '$lib/date';

	interface Props {
		terms: ContractTerms;
		dimmed?: boolean;
		heading?: string;
	}

	let { terms, dimmed = false, heading = 'Services & sessions' }: Props = $props();
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
					${centsToDollars(service.rateCents)}/hr · {minutesToHours(
						weeklyMinutes(service.sessions)
					)}
					hrs/wk =
					<strong class="text-secondary">
						${centsToDollars(serviceWeeklyCents(service.rateCents, service.sessions))}/wk
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
				{#if service.sessions.length > 0}
					<div class="mt-2 flex flex-col gap-1.5">
						{#each service.sessions as session, index (index)}
							<div class="flex items-center gap-2.5 rounded-lg border border-base-300 px-3 py-1.5">
								<i class="las la-clock text-neutral" aria-hidden="true"></i>
								<span class="text-[12.5px] font-semibold text-base-content">
									{WEEKDAY_LABELS[session.weekday]}
									{formatSessionRange(session)}
									<span class="font-normal text-outline">
										· {minutesToHours(sessionMinutes(session))} hrs
									</span>
								</span>
								<span
									class="ml-auto rounded-full bg-base-500 px-2.5 py-0.5 text-[10.5px]
										font-semibold text-info"
								>
									Proposed
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>

	{#if terms.startsOn || terms.endsOn}
		<div
			class="mt-1 grid grid-cols-[90px_1fr] items-center gap-x-4 gap-y-2 border-t border-base-300
				pt-3 text-[13px]"
		>
			{#if terms.startsOn}
				<span class="text-base-content-muted">Starts</span>
				<span class="font-medium text-base-content">{formatDateWithWeekday(terms.startsOn)}</span>
			{/if}
			<span class="text-base-content-muted">Ends</span>
			<span class="font-medium text-base-content">
				{terms.endsOn ? formatDateWithWeekday(terms.endsOn) : 'Ongoing'}
			</span>
		</div>
	{/if}

	<div class="mt-3 flex items-center justify-between border-t border-base-300 pt-3">
		<span class="text-[12.5px] text-base-content-muted">Weekly estimate</span>
		<span class="font-display text-base font-bold text-secondary">
			${centsToDollars(terms.weeklyEstimateCents)}
		</span>
	</div>
</section>
