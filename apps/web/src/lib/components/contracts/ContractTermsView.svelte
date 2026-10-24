<script lang="ts">
	/** Read-only terms rendering (Flow F): service line items with per-session
	 * rows and derived rate math, the starts/ends grid and the weekly estimate.
	 * `dimmed` is the declined-terms treatment (16j) — visible but clearly out
	 * of force. */
	import type { ContractTerms } from '$lib/api/contracts';
	import {
		formatEndTime,
		formatSessionRange,
		minutesToHours,
		serviceWeeklyCents,
		sessionMinutes,
		weeklyMinutes,
		weekdayLabel
	} from '$lib/contract-sessions';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { formatDateWithWeekday } from '$lib/date';
	import PriceBreakdown from '$lib/components/contracts/PriceBreakdown.svelte';

	interface Props {
		terms: ContractTerms;
		dimmed?: boolean;
		heading?: string;
		/** "Central Time" — the zone session times are read in. */
		timeZoneLabel?: string | null;
		/** The zone is the family's: they read "your local time". */
		viewerIsFamily?: boolean;
	}

	let {
		terms,
		dimmed = false,
		heading = m.contracts_terms_heading(),
		timeZoneLabel = null,
		viewerIsFamily = false
	}: Props = $props();

	// Each session is labelled by where the terms stand (UAT #40): an active
	// contract's sessions are agreed, not "Proposed".
	const sessionLabel = $derived(
		terms.status === 'accepted' || terms.status === 'superseded'
			? m.contracts_session_agreed()
			: terms.status === 'declined'
				? m.contracts_session_declined()
				: terms.status === 'withdrawn'
					? m.contracts_session_withdrawn()
					: m.contracts_session_proposed()
	);
</script>

<section
	class={['rounded-xl border border-card-border bg-base-100 px-5 py-4', dimmed ? 'opacity-70' : '']}
>
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{heading}
	</h3>
	{#if timeZoneLabel}
		<p class="-mt-1 mb-2 text-[11px] text-outline">
			{viewerIsFamily
				? m.contracts_terms_times_yours({ zone: timeZoneLabel })
				: m.contracts_terms_times_family({ zone: timeZoneLabel })}
		</p>
	{/if}
	<ul>
		{#each terms.services as service (service.serviceId)}
			<li class="border-b border-base-300 py-2.5 last:border-b-0">
				<div class="text-[13.5px] font-semibold text-base-content">{service.name}</div>
				<div class="mt-0.5 text-xs text-base-content-muted">
					{m.contracts_per_hour({ amount: formatMoney(service.rateCents) })} · {m.contracts_hours_per_week(
						{ hours: minutesToHours(weeklyMinutes(service.sessions)) }
					)} =
					<strong class="text-secondary">
						{m.contracts_per_week({
							amount: formatMoney(serviceWeeklyCents(service.rateCents, service.sessions))
						})}
					</strong>
					{#if service.rateCents > service.listedRateCents}
						<span class="text-outline">
							· {m.contracts_listed_rate({ amount: formatMoney(service.listedRateCents) })}</span
						>
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
									{weekdayLabel(session.weekday)}
									{formatSessionRange(session)}
									<span class="font-normal text-outline">
										· {m.contracts_hours_short({ hours: minutesToHours(sessionMinutes(session)) })}
									</span>
								</span>
								<span
									class="ml-auto rounded-full bg-base-500 px-2.5 py-0.5 text-[10.5px]
										font-semibold text-info"
								>
									{sessionLabel}
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
				<span class="text-base-content-muted">{m.contracts_terms_starts()}</span>
				<span class="font-medium text-base-content">{formatDateWithWeekday(terms.startsOn)}</span>
			{/if}
			<span class="text-base-content-muted">{m.contracts_terms_ends()}</span>
			<span class="font-medium text-base-content">
				{#if terms.endsOn}
					{terms.endsAtMinutes
						? m.contracts_date_until({
								date: formatDateWithWeekday(terms.endsOn),
								time: formatEndTime(terms.endsAtMinutes)
							})
						: formatDateWithWeekday(terms.endsOn)}
				{:else}
					{m.contracts_terms_ongoing()}
				{/if}
			</span>
		</div>
	{/if}

	<div class="mt-3 flex items-center justify-between border-t border-base-300 pt-3">
		<span class="text-[12.5px] text-base-content-muted">{m.contracts_weekly_estimate()}</span>
		<span class="font-display text-base font-bold text-secondary">
			{formatMoney(terms.weeklyEstimateCents)}
		</span>
	</div>

	{#if terms.pricing}
		<div class="mt-3">
			<PriceBreakdown pricing={terms.pricing} viewerSide={viewerIsFamily ? 'family' : 'provider'} />
		</div>
	{/if}
</section>
