<script lang="ts">
	/** Staging UAT — the billing clock: every live contract with its next
	 * billing event, and the latest fast-forward runs. Opening a contract
	 * lists its upcoming events, each with "Run up to here". Only reachable
	 * where the API's switch is on (the nav hides it otherwise; the API
	 * answers 404). */
	import { resolve } from '$app/paths';
	import { listBillingClockContracts, type BillingClockOverview } from '$lib/api/billing-clock';
	import BillingClockRuns from '$lib/components/admin/BillingClockRuns.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import {
		billingClockErrorMessage,
		billingClockEventLabel,
		billingClockInstant,
		billingStatusChip
	} from '$lib/billing-clock';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	let overview = $state<BillingClockOverview | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);

	async function load() {
		const result = await listBillingClockContracts();
		loading = false;
		if (result.ok) {
			overview = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(billingClockErrorMessage(result.error));
		}
	}

	$effect(() => {
		void load();
	});
</script>

<svelte:head>
	<title>{m.admin_billing_clock_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.admin_billing_clock_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">{m.admin_billing_clock_intro()}</p>
</div>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed || !overview}
	<p class="text-sm text-base-content-muted">{m.admin_billing_clock_load_failed()}</p>
{:else}
	<h2 class="mb-3 font-display text-lg font-bold text-base-content">
		{m.admin_billing_clock_contracts_heading()}
	</h2>
	{#if overview.contracts.length === 0}
		<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
			<p class="text-sm text-base-content-muted">{m.admin_billing_clock_contracts_empty()}</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-3" data-testid="billing-clock-contracts">
			{#each overview.contracts as row (row.contractId)}
				{@const chip = billingStatusChip(row.status)}
				<li
					class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-base-100 px-4 py-3"
					data-testid="billing-clock-contract"
				>
					<div class="min-w-0 flex-1">
						<p class="font-semibold text-base-content">
							{m.admin_billing_clock_contract_heading({
								family: row.familyName ?? m.admin_billing_clock_unknown_party(),
								helper: row.helperName ?? m.admin_billing_clock_unknown_party()
							})}
						</p>
						<p class="text-[12.5px] text-base-content-muted">
							<span class="font-semibold">{m.admin_billing_clock_col_next()}:</span>
							{#if row.nextEvent}
								{billingClockEventLabel(row.nextEvent)} · {billingClockInstant(
									row.nextEvent.at,
									row.timeZone
								)}
							{:else}
								{m.admin_billing_clock_no_event()}
							{/if}
						</p>
					</div>
					<StatusChip status={chip.status} label={chip.label} />
					<a
						class="btn btn-outline btn-sm"
						href={resolve('/admin/billing-clock/[id]', { id: row.contractId })}
						data-testid="billing-clock-open"
					>
						{m.admin_billing_clock_open()}
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	<BillingClockRuns runs={overview.runs} />
{/if}
