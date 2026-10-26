<script lang="ts">
	/** Read-only week strip (Flow F, provider review): every service's sessions
	 * combined into one Mon–Sun row so the reviewer can hold the proposal
	 * against their own week — clash-checking is on them, and this is the tool
	 * for it. Chips stack chronologically within a day; columns cap at four
	 * rows, the rest collapsing into "+N more" (expands on tap). Below 640px
	 * the days stack vertically (UAT round 2 #3). */
	import type { ContractServiceItem } from '$lib/api/contracts';
	import {
		bySessionStart,
		formatSessionRange,
		serviceCode,
		weekdayLabels
	} from '$lib/contract-sessions';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		services: ContractServiceItem[];
		/** Signed terms read "Agreed", not "Proposed" (UAT #40). */
		agreed?: boolean;
	}

	let { services, agreed = false }: Props = $props();

	/** Chip palette by service order — soft tint + readable label color, cycled
	 * (the design shows three; four covers the 20-service cap without repeats
	 * looking adjacent). */
	const PALETTES = [
		{ chip: 'border-base-600 bg-base-500', code: 'text-info' },
		{ chip: 'border-card-border bg-base-300', code: 'text-secondary' },
		{ chip: 'border-success/30 bg-success-content', code: 'text-success' },
		{ chip: 'border-warning-border bg-warning-content', code: 'text-warning' }
	] as const;

	const legend = $derived(
		services
			.filter((service) => service.sessions.length > 0)
			.map((service, index) => ({
				name: service.name,
				code: serviceCode(service.name),
				palette: PALETTES[index % PALETTES.length]
			}))
	);

	const days = $derived(
		weekdayLabels().map((label, weekday) => ({
			label,
			chips: services
				.flatMap((service, index) =>
					service.sessions
						.filter((session) => session.weekday === weekday)
						.map((session) => ({
							session,
							code: serviceCode(service.name),
							name: service.name,
							palette: PALETTES[index % PALETTES.length]
						}))
				)
				.sort((a, b) => bySessionStart(a.session, b.session))
		}))
	);

	const VISIBLE_ROWS = 3;
	let expandedDays = $state<number[]>([]);
	const isExpanded = (weekday: number) => expandedDays.includes(weekday);
</script>

<div class="min-w-0 rounded-xl border border-card-border bg-base-100 px-4 py-3.5">
	<div class="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
		<h3 class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
			{agreed ? m.contracts_week_glance_agreed() : m.contracts_week_glance_proposed()}
		</h3>
		<p class="text-[11px] text-outline">{m.contracts_week_glance_hint()}</p>
	</div>
	<!-- UAT round 2 #3: below 640px the days stack (one row per day, chips
	     wrapping), so nothing overflows a phone; from 640px it is a 7-column
	     grid of equal, shrinkable columns. -->
	<div class="flex flex-col divide-y divide-base-300 sm:grid sm:grid-cols-7 sm:gap-2 sm:divide-y-0">
		{#each days as day, weekday (day.label)}
			<div
				class="flex min-w-0 items-start gap-3 py-1.5 first:pt-0 last:pb-0 sm:block sm:py-0"
				data-testid="week-glance-day"
			>
				<div
					class="w-10 shrink-0 pt-1 text-[10.5px] font-bold text-base-content-muted sm:mb-1.5
						sm:w-auto sm:pt-0 sm:text-center"
				>
					{day.label}
				</div>
				<div class="flex min-w-0 flex-1 flex-wrap gap-1.5 sm:flex-col sm:flex-nowrap">
					{#if day.chips.length === 0}
						<div
							class="rounded-lg border border-dashed border-base-300 px-3 py-1 text-center text-[10px]
								text-outline-variant sm:px-0 sm:py-2.5"
							aria-label={m.contracts_week_glance_no_sessions({ day: day.label })}
						>
							—
						</div>
					{:else}
						{#each isExpanded(weekday) || day.chips.length <= VISIBLE_ROWS + 1 ? day.chips : day.chips.slice(0, VISIBLE_ROWS) as chip (`${chip.name}-${chip.session.startMinutes}-${chip.session.endMinutes}`)}
							<div
								class={['min-w-0 max-w-full rounded-lg border px-1.5 py-1', chip.palette.chip]}
								title="{chip.name} · {day.label} {formatSessionRange(chip.session)}"
							>
								<div class={['truncate text-[9px] font-bold tracking-[0.04em]', chip.palette.code]}>
									{chip.code}
								</div>
								<div class="mt-px truncate text-[10.5px] font-semibold text-base-content">
									{formatSessionRange(chip.session)}
								</div>
							</div>
						{/each}
						{#if !isExpanded(weekday) && day.chips.length > VISIBLE_ROWS + 1}
							<button
								type="button"
								class="rounded-lg border border-dashed border-outline-variant px-1.5 py-1
									text-center text-[10px] font-semibold text-secondary hover:border-primary"
								onclick={() => (expandedDays = [...expandedDays, weekday])}
							>
								{m.contracts_week_glance_more({ count: day.chips.length - VISIBLE_ROWS })}
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
	{#if legend.length > 0}
		<ul class="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] text-outline">
			{#each legend as entry (entry.name)}
				<!-- Long service names truncate; the full name is the tooltip. -->
				<li class="max-w-full min-w-0 truncate sm:max-w-[16rem]" title={entry.name}>
					<strong class={entry.palette.code}>{entry.code}</strong>
					{entry.name}
				</li>
			{/each}
		</ul>
	{/if}
</div>
