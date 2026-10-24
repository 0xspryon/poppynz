<script lang="ts">
	import {
		formatTaxRate,
		getTaxReport,
		taxComponentLabel,
		taxReportCsvUrl,
		taxWriteErrorText,
		type TaxReport
	} from '$lib/api/tax';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const pad = (value: number) => String(value).padStart(2, '0');
	const now = new Date();
	const firstOfMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

	let from = $state(firstOfMonth);
	let to = $state(today);
	let period = $state<'month' | 'quarter'>('month');
	let report = $state<TaxReport | null>(null);
	let loading = $state(false);

	const SUPPLIES: Record<string, () => string> = {
		family_service_fee: m.accountant_reports_supply_family_service_fee,
		provider_commission: m.accountant_reports_supply_provider_commission,
		credibled_check: m.accountant_reports_supply_credibled_check,
		credibled_admin_fee: m.accountant_reports_supply_credibled_admin_fee,
		care_service_value: m.accountant_reports_supply_care_service_value,
		cancellation_compensation: m.accountant_reports_supply_cancellation_compensation
	};
	const supplyLabel = (code: string) => SUPPLIES[code]?.() ?? code;

	async function run(event?: SubmitEvent) {
		event?.preventDefault();
		if (loading) return;
		loading = true;
		const result = await getTaxReport({ from, to, period });
		loading = false;
		if (result.ok) {
			report = result.data;
		} else {
			toast.error(taxWriteErrorText(result.error), { title: m.accountant_reports_not_run_title() });
		}
	}

	const csvHref = $derived(taxReportCsvUrl({ from, to, period }));
</script>

<svelte:head>
	<title>{m.accountant_reports_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.accountant_reports_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">
		{m.accountant_reports_intro()}
	</p>
</div>

<form class="mb-6 flex flex-wrap items-end gap-3" onsubmit={run}>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">{m.accountant_reports_from()}</span>
		<input type="date" class="input input-bordered input-sm" bind:value={from} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">{m.accountant_reports_to()}</span>
		<input type="date" class="input input-bordered input-sm" bind:value={to} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">{m.accountant_reports_group_by()}</span>
		<select class="select select-bordered select-sm" bind:value={period}>
			<option value="month">{m.accountant_reports_month()}</option>
			<option value="quarter">{m.accountant_reports_quarter()}</option>
		</select>
	</label>
	<button type="submit" class="btn btn-primary btn-sm" disabled={loading}>
		{#if loading}<span class="loading loading-spinner loading-xs"></span>{/if}
		{m.accountant_reports_run()}
	</button>
	<a class="btn btn-outline btn-sm" href={csvHref} download rel="external">
		<i class="las la-file-csv" aria-hidden="true"></i>
		{m.accountant_reports_export()}
	</a>
</form>

{#if report}
	{#if report.rows.length === 0}
		<p class="text-sm text-base-content-muted">{m.accountant_reports_empty()}</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
			<table class="table">
				<thead>
					<tr>
						<th>{m.accountant_reports_col_period()}</th>
						<th>{m.accountant_jurisdiction()}</th>
						<th>{m.accountant_component()}</th>
						<th>{m.accountant_col_supply()}</th>
						<th class="text-right">{m.accountant_col_rate()}</th>
						<th class="text-right">{m.accountant_reports_col_base()}</th>
						<th class="text-right">{m.accountant_reports_col_tax()}</th>
					</tr>
				</thead>
				<tbody>
					{#each report.rows as row (`${row.period}|${row.jurisdiction}|${row.component}|${row.supplyType}|${row.rateMillipercent}`)}
						<tr>
							<td>{row.period}</td>
							<td>{row.jurisdiction}</td>
							<td>{taxComponentLabel(row.component)}</td>
							<td>{supplyLabel(row.supplyType)}</td>
							<td class="text-right tabular-nums">{formatTaxRate(row.rateMillipercent)}</td>
							<td class="text-right tabular-nums">{formatMoney(row.baseCents)}</td>
							<td class="text-right tabular-nums">{formatMoney(row.taxCents)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="6" class="text-right font-semibold">{m.accountant_reports_total()}</td>
						<td class="text-right font-semibold tabular-nums"
							>{formatMoney(report.totalTaxCents)}</td
						>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
{/if}
