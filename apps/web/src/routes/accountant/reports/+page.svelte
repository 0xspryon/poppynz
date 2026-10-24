<script lang="ts">
	import { getTaxReport, taxReportCsvUrl, taxWriteErrorText, type TaxReport } from '$lib/api/tax';
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

	const SUPPLIES: Record<string, string> = {
		family_service_fee: 'Family service fee',
		provider_commission: 'Helper commission',
		credibled_check: 'Background check',
		credibled_admin_fee: 'Background-check admin fee',
		care_service_value: 'Care service value',
		cancellation_compensation: 'Cancellation compensation'
	};

	const money = (cents: number) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);

	async function run(event?: SubmitEvent) {
		event?.preventDefault();
		if (loading) return;
		loading = true;
		const result = await getTaxReport({ from, to, period });
		loading = false;
		if (result.ok) {
			report = result.data;
		} else {
			toast.error(taxWriteErrorText(result.error), { title: 'Report not run' });
		}
	}

	const csvHref = $derived(taxReportCsvUrl({ from, to, period }));
</script>

<svelte:head>
	<title>Tax collected · Poppynz accountant</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">Tax collected</h1>
	<p class="text-sm text-base-content-muted">
		By period, jurisdiction, component and supply, from the tax lines frozen on what was actually
		charged (captured). Refunded charges are left out. Periods follow Toronto time.
	</p>
</div>

<form class="mb-6 flex flex-wrap items-end gap-3" onsubmit={run}>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">From</span>
		<input type="date" class="input input-bordered input-sm" bind:value={from} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">To</span>
		<input type="date" class="input input-bordered input-sm" bind:value={to} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium text-base-content">Group by</span>
		<select class="select select-bordered select-sm" bind:value={period}>
			<option value="month">Month</option>
			<option value="quarter">Quarter</option>
		</select>
	</label>
	<button type="submit" class="btn btn-primary btn-sm" disabled={loading}>
		{#if loading}<span class="loading loading-spinner loading-xs"></span>{/if}
		Run report
	</button>
	<a class="btn btn-outline btn-sm" href={csvHref} download rel="external">
		<i class="las la-file-csv" aria-hidden="true"></i>
		Export CSV
	</a>
</form>

{#if report}
	{#if report.rows.length === 0}
		<p class="text-sm text-base-content-muted">No tax was collected in this period.</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
			<table class="table">
				<thead>
					<tr>
						<th>Period</th>
						<th>Jurisdiction</th>
						<th>Component</th>
						<th>Supply</th>
						<th class="text-right">Rate</th>
						<th class="text-right">Taxed base</th>
						<th class="text-right">Tax</th>
					</tr>
				</thead>
				<tbody>
					{#each report.rows as row (`${row.period}|${row.jurisdiction}|${row.component}|${row.supplyType}|${row.rateMillipercent}`)}
						<tr>
							<td>{row.period}</td>
							<td>{row.jurisdiction}</td>
							<td>{row.component.toUpperCase()}</td>
							<td>{SUPPLIES[row.supplyType] ?? row.supplyType}</td>
							<td class="text-right tabular-nums">{row.rateMillipercent / 1000}%</td>
							<td class="text-right tabular-nums">{money(row.baseCents)}</td>
							<td class="text-right tabular-nums">{money(row.taxCents)}</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="6" class="text-right font-semibold">Total</td>
						<td class="text-right font-semibold tabular-nums">{money(report.totalTaxCents)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	{/if}
{/if}
