<script lang="ts">
	/** Staging UAT — one contract on the billing clock: its cycles, every
	 * upcoming billing event (hold, capture, transfer, retries, deadlines) and
	 * the latest runs. "Run up to here" runs this contract's billing — and
	 * only this contract's — as if it were that event's time; the API audits
	 * every run. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		getBillingClockContract,
		runBillingClock,
		type BillingClockDetail,
		type BillingClockEvent
	} from '$lib/api/billing-clock';
	import BillingClockRuns from '$lib/components/admin/BillingClockRuns.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import {
		billingClockErrorMessage,
		billingClockEventLabel,
		billingClockInstant,
		billingStatusChip,
		billingStatusLabel
	} from '$lib/billing-clock';
	import { cycleChip } from '$lib/contract-cycle-status';
	import { formatDate } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const id = $derived(page.params.id ?? '');

	let detail = $state<BillingClockDetail | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);
	let busy = $state(false);
	/** The event whose "Run up to here" awaits confirmation. */
	let confirming = $state<BillingClockEvent | null>(null);

	async function load(contractId: string) {
		const result = await getBillingClockContract(contractId);
		loading = false;
		if (result.ok) {
			detail = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(billingClockErrorMessage(result.error));
		}
	}

	$effect(() => {
		if (id) void load(id);
	});

	/** An instant as the contract's billing reads it (its time zone). */
	const instant = (value: string) => billingClockInstant(value, detail?.contract.timeZone);

	async function runUpTo() {
		if (!confirming || busy) return;
		const event = confirming;
		busy = true;
		const result = await runBillingClock(id, event.at);
		confirming = null;
		const when = instant(event.at);
		if (result.ok && result.data.run.status === 'succeeded') {
			toast.success(
				m.admin_billing_clock_ran({
					when,
					status: billingStatusLabel(result.data.run.billingStatusAfter)
				})
			);
		} else if (result.ok) {
			toast.error(m.admin_billing_clock_ran_failed({ when }));
		} else {
			toast.error(billingClockErrorMessage(result.error));
		}
		// Every button stays disabled until the refreshed state is shown.
		await load(id);
		busy = false;
	}

	const cycleDates = (startsOn: string, endsOn: string) =>
		startsOn === endsOn ? formatDate(startsOn) : `${formatDate(startsOn)} – ${formatDate(endsOn)}`;
</script>

<svelte:head>
	<title>
		{m.admin_billing_clock_contract_page_title({
			family: detail?.contract.familyName ?? m.admin_billing_clock_unknown_party()
		})}
	</title>
</svelte:head>

<a
	class="mb-4 inline-flex items-center gap-1 text-sm text-primary"
	href={resolve('/admin/billing-clock')}
>
	<i class="las la-arrow-left" aria-hidden="true"></i>
	{m.admin_billing_clock_back()}
</a>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed || !detail}
	<p class="text-sm text-base-content-muted">{m.admin_billing_clock_load_failed()}</p>
{:else}
	{@const status = billingStatusChip(detail.contract.status)}
	<div class="mb-6 flex flex-wrap items-start gap-3">
		<div class="min-w-0 flex-1">
			<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
				{m.admin_billing_clock_contract_heading({
					family: detail.contract.familyName ?? m.admin_billing_clock_unknown_party(),
					helper: detail.contract.helperName ?? m.admin_billing_clock_unknown_party()
				})}
			</h1>
			<p class="text-sm text-base-content-muted">
				{m.admin_billing_clock_contract_meta({
					date: formatDate(detail.contract.startsOn),
					zone: detail.contract.timeZone
				})}
			</p>
		</div>
		<span data-testid="billing-clock-status">
			<StatusChip status={status.status} label={status.label} />
		</span>
	</div>

	<h2 class="mb-1 font-display text-lg font-bold text-base-content">
		{m.admin_billing_clock_events_heading()}
	</h2>
	<p class="mb-3 text-[12.5px] text-base-content-muted">
		{m.admin_billing_clock_events_hint({ zone: detail.contract.timeZone })}
	</p>
	{#if detail.events.length === 0}
		<div class="rounded-xl border border-card-border bg-base-100 p-8 text-center">
			<p class="text-sm text-base-content-muted">{m.admin_billing_clock_events_empty()}</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-2" data-testid="billing-clock-events">
			{#each detail.events as event (`${event.kind}-${event.subjectId}-${event.at}`)}
				<li
					class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-card-border bg-base-100 px-4 py-2.5"
					data-testid="billing-clock-event"
				>
					<div class="min-w-0 flex-1">
						<p class="font-semibold text-base-content">{billingClockEventLabel(event)}</p>
						<p class="text-[12.5px] text-base-content-muted">{instant(event.at)}</p>
						{#if !event.withinLimit}
							<p class="text-[12px] text-outline">
								{m.admin_billing_clock_beyond_limit({ days: String(detail.maxDays) })}
							</p>
						{/if}
					</div>
					<button
						type="button"
						class="btn btn-sm btn-primary"
						disabled={busy || !event.withinLimit}
						onclick={() => (confirming = event)}
						data-testid="billing-clock-run-here"
					>
						<i class="las la-forward" aria-hidden="true"></i>
						{m.admin_billing_clock_run_here()}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="mt-8 mb-3 font-display text-lg font-bold text-base-content">
		{m.admin_billing_clock_cycles_heading()}
	</h2>
	{#if detail.cycles.length === 0}
		<p class="text-sm text-base-content-muted">{m.admin_billing_clock_cycles_empty()}</p>
	{:else}
		<ul class="flex flex-col gap-2" data-testid="billing-clock-cycles">
			{#each detail.cycles as cycle (cycle.id)}
				{@const chip = cycleChip(cycle.status, true)}
				<li
					class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-card-border bg-base-100 px-4 py-2 text-[12.5px]"
					data-testid="billing-clock-cycle"
					data-status={cycle.status}
				>
					<span class="min-w-0 flex-1">
						<span class="font-semibold text-base-content">
							{m.admin_billing_clock_cycle_name({ number: String(cycle.number) })}
						</span>
						<span class="text-base-content-muted">
							· {cycleDates(cycle.startsOn, cycle.endsOn)}</span
						>
					</span>
					{#if cycle.familyTotalCents !== null}
						<span class="font-semibold tabular-nums">{formatMoney(cycle.familyTotalCents)}</span>
					{/if}
					<StatusChip status={chip.status} label={chip.label} />
				</li>
			{/each}
		</ul>
	{/if}

	<BillingClockRuns runs={detail.runs} />
{/if}

{#if confirming}
	<ConfirmDialog
		open={confirming !== null}
		title={m.admin_billing_clock_confirm_title()}
		body={m.admin_billing_clock_confirm_body({ when: instant(confirming.at) })}
		confirmLabel={m.admin_billing_clock_confirm()}
		cancelLabel={m.common_cancel()}
		confirmClass="btn-warning"
		{busy}
		onconfirm={() => void runUpTo()}
		oncancel={() => (confirming = null)}
	>
		<p class="text-sm font-semibold text-base-content">{billingClockEventLabel(confirming)}</p>
	</ConfirmDialog>
{/if}
