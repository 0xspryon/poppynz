<script lang="ts">
	/** The billing clock's audit trail: who ran which contract's billing up to
	 * when, for which event, and what came of it. */
	import type { BillingClockRun } from '$lib/api/billing-clock';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { billingStatusLabel, runChip } from '$lib/billing-clock';
	import { formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		runs: ReadonlyArray<BillingClockRun>;
	}

	let { runs }: Props = $props();
</script>

<h2 class="mt-8 mb-3 font-display text-lg font-bold text-base-content">
	{m.admin_billing_clock_runs_heading()}
</h2>
{#if runs.length === 0}
	<p class="text-sm text-base-content-muted">{m.admin_billing_clock_runs_empty()}</p>
{:else}
	<ul class="flex flex-col gap-2" data-testid="billing-clock-runs">
		{#each runs as run (run.id)}
			{@const chip = runChip(run.status)}
			<li
				class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-card-border bg-base-100 px-4 py-2 text-[12.5px]"
				data-testid="billing-clock-run"
			>
				<div class="min-w-0 flex-1">
					<!-- The event as recorded in the audit trail (English, verbatim). -->
					<p class="font-semibold text-base-content">
						{run.eventLabel ?? m.admin_billing_clock_run_custom()}
					</p>
					<p class="text-base-content-muted">
						{m.admin_billing_clock_run_line({
							actor: run.actorName,
							when: formatDateTime(run.targetAt)
						})}
						· {m.admin_billing_clock_run_status_change({
							before: billingStatusLabel(run.billingStatusBefore),
							after: billingStatusLabel(run.billingStatusAfter)
						})}
					</p>
					{#if run.error}
						<p class="text-error">{run.error}</p>
					{/if}
				</div>
				<span class="text-outline">{formatDateTime(run.startedAt)}</span>
				<StatusChip status={chip.status} label={chip.label} />
			</li>
		{/each}
	</ul>
{/if}
