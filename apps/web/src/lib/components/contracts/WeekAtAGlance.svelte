<script lang="ts">
	/** Read-only week strip (Flow F, provider review): every service's sessions
	 * combined into one Mon–Sun row so the reviewer can hold the proposal
	 * against their own week — clash-checking is on them, and this is the tool
	 * for it. Chips stack chronologically within a day; columns cap at four
	 * rows, the rest collapsing into "+N more" (expands on tap). On small
	 * screens the strip is a horizontal scroll bin. */
	import type { ContractServiceItem } from '$lib/api/contracts';
	import {
		bySessionStart,
		formatSessionRange,
		serviceCode,
		WEEKDAY_LABELS
	} from '$lib/contract-sessions';

	interface Props {
		services: ContractServiceItem[];
	}

	let { services }: Props = $props();

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
		WEEKDAY_LABELS.map((label, weekday) => ({
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

<div class="rounded-xl border border-card-border bg-base-100 px-4 py-3.5">
	<div class="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
		<h3 class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
			Proposed week at a glance
		</h3>
		<p class="text-[11px] text-outline">all services combined — hold it against your own week</p>
	</div>
	<div class="flex gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
		{#each days as day, weekday (day.label)}
			<div class="w-24 flex-none sm:w-auto sm:min-w-0 sm:flex-1">
				<div class="mb-1.5 text-center text-[10.5px] font-bold text-base-content-muted">
					{day.label}
				</div>
				<div class="flex flex-col gap-1.5">
					{#if day.chips.length === 0}
						<div
							class="rounded-lg border border-dashed border-base-300 py-2.5 text-center text-[10px]
								text-outline-variant"
							aria-label="No sessions on {day.label}"
						>
							—
						</div>
					{:else}
						{#each isExpanded(weekday) || day.chips.length <= VISIBLE_ROWS + 1 ? day.chips : day.chips.slice(0, VISIBLE_ROWS) as chip (`${chip.name}-${chip.session.startMinutes}-${chip.session.endMinutes}`)}
							<div
								class={['rounded-lg border px-1.5 py-1', chip.palette.chip]}
								title="{chip.name} · {day.label} {formatSessionRange(chip.session)}"
							>
								<div class={['text-[9px] font-bold tracking-[0.04em]', chip.palette.code]}>
									{chip.code}
								</div>
								<div class="mt-px text-[10.5px] font-semibold whitespace-nowrap text-base-content">
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
								+{day.chips.length - VISIBLE_ROWS} more
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>
	{#if legend.length > 0}
		<div class="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] text-outline">
			{#each legend as entry (entry.name)}
				<span>
					<strong class={entry.palette.code}>{entry.code}</strong>
					{entry.name}
				</span>
			{/each}
		</div>
	{/if}
</div>
