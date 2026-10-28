<script lang="ts">
	/** The accountant's money reports (Tier 3 step 5), per Toronto month, on
	 * screen and as CSV: liabilities at month end, refunds issued with the
	 * tax they returned, costs Poppynz absorbed by cause, and Stripe fees. */
	import {
		accountantErrorText,
		causeLabel,
		getAccountantReport,
		reportCsvUrl,
		reportLabel,
		type ReportKind
	} from '$lib/api/accountant';
	import { formatDateTimeIn } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	type Result = Extract<Awaited<ReturnType<typeof getAccountantReport>>, { ok: true }>['data'];

	const pad = (value: number) => String(value).padStart(2, '0');
	const now = new Date();
	const startOfYear = `${now.getFullYear()}-01-01`;
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const KINDS: ReadonlyArray<ReportKind> = ['liabilities', 'refunds', 'absorbed', 'fees'];

	let kind = $state<ReportKind>('liabilities');
	let from = $state(startOfYear);
	let to = $state(today);
	let result = $state.raw<Result | null>(null);
	let loading = $state(false);

	const intro = (report: ReportKind) =>
		report === 'liabilities'
			? m.books_report_liabilities_intro()
			: report === 'refunds'
				? m.books_report_refunds_intro()
				: report === 'absorbed'
					? m.books_report_absorbed_intro()
					: m.books_report_fees_intro();

	async function run(event?: SubmitEvent) {
		event?.preventDefault();
		if (loading) return;
		loading = true;
		const response = await getAccountantReport(kind, from, to);
		loading = false;
		if (response.ok) result = response.data;
		else
			toast.error(accountantErrorText(response.error), { title: m.books_reports_not_run_title() });
	}

	const csvHref = $derived(reportCsvUrl(kind, from, to));
	const line = (value: { count: number; amountCents: number }) =>
		m.books_count_amount({ amount: formatMoney(value.amountCents), count: String(value.count) });
</script>

<svelte:head>
	<title>{m.books_reports_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.books_reports_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">{m.books_reports_intro()}</p>
</div>

<form class="mb-3 flex flex-wrap items-end gap-3" onsubmit={run}>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_reports_report()}</span>
		<select class="select-bordered select select-sm" bind:value={kind} data-testid="report-kind">
			{#each KINDS as value (value)}
				<option {value}>{reportLabel(value)}</option>
			{/each}
		</select>
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_from()}</span>
		<input type="date" class="input-bordered input input-sm" bind:value={from} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_to()}</span>
		<input type="date" class="input-bordered input input-sm" bind:value={to} required />
	</label>
	<button type="submit" class="btn btn-sm btn-primary" disabled={loading}>
		{#if loading}<span class="loading loading-xs loading-spinner"></span>{/if}
		{m.books_reports_run()}
	</button>
	<a class="btn btn-outline btn-sm" href={csvHref} download rel="external">
		<i class="las la-file-csv" aria-hidden="true"></i>
		{m.books_export_csv()}
	</a>
</form>
<p class="mb-6 text-xs text-base-content-muted">{intro(kind)}</p>

{#if result}
	{#if result.rows.length === 0}
		<p class="text-sm text-base-content-muted">{m.books_reports_empty()}</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
			<table class="table table-sm" data-testid="report-table">
				{#if result.report === 'liabilities'}
					<thead>
						<tr>
							<th>{m.books_col_month()}</th>
							<th class="hidden md:table-cell">{m.books_col_as_of()}</th>
							<th class="text-right">{m.books_liab_held()}</th>
							<th class="text-right">{m.books_liab_recoveries()}</th>
							<th class="text-right">{m.books_liab_refunds()}</th>
							<th class="text-right">{m.books_liab_extras()}</th>
						</tr>
					</thead>
					<tbody>
						{#each result.rows as row (row.month)}
							<tr>
								<td>{row.month}{row.approximate ? ' *' : ''}</td>
								<td class="hidden md:table-cell">{formatDateTimeIn(row.asOf, 'America/Toronto')}</td
								>
								<td class="text-right tabular-nums">{line(row.heldHelperPay)}</td>
								<td class="text-right tabular-nums">{line(row.outstandingRecoveries)}</td>
								<td class="text-right tabular-nums">{line(row.refundsInFlight)}</td>
								<td class="text-right tabular-nums">{line(row.unpaidExtraSessions)}</td>
							</tr>
						{/each}
					</tbody>
				{:else if result.report === 'refunds'}
					<thead>
						<tr>
							<th>{m.books_col_month()}</th>
							<th class="text-right">{m.books_col_refunds()}</th>
							<th class="hidden text-right md:table-cell">{m.books_col_handled()}</th>
							<th class="text-right">{m.books_col_refunded()}</th>
							<th class="text-right">{m.books_col_tax_returned()}</th>
							<th class="text-right">{m.books_col_commission_tax()}</th>
						</tr>
					</thead>
					<tbody>
						{#each result.rows as row (row.month)}
							<tr>
								<td>{row.month}</td>
								<td class="text-right tabular-nums">{row.count}</td>
								<td class="hidden text-right tabular-nums md:table-cell">{row.handledCount}</td>
								<td class="text-right tabular-nums">{formatMoney(row.refundedCents)}</td>
								<td class="text-right tabular-nums">{formatMoney(row.taxReturnedCents)}</td>
								<td class="text-right tabular-nums">
									{formatMoney(row.commissionTaxReversedCents)}
								</td>
							</tr>
						{/each}
					</tbody>
				{:else if result.report === 'absorbed'}
					<thead>
						<tr>
							<th>{m.books_col_month()}</th>
							<th>{m.books_col_cause()}</th>
							<th class="text-right">{m.books_col_items()}</th>
							<th class="text-right">{m.books_col_absorbed()}</th>
						</tr>
					</thead>
					<tbody>
						{#each result.rows as row (`${row.month}|${row.cause}`)}
							<tr>
								<td>{row.month}</td>
								<td>{causeLabel(row.cause)}</td>
								<td class="text-right tabular-nums">{row.count}</td>
								<td class="text-right tabular-nums">{formatMoney(row.amountCents)}</td>
							</tr>
						{/each}
					</tbody>
				{:else}
					<thead>
						<tr>
							<th>{m.books_col_month()}</th>
							<th class="hidden text-right md:table-cell">{m.books_col_transactions()}</th>
							<th class="text-right">{m.books_col_processing()}</th>
							<th class="text-right">{m.books_col_dispute_fees()}</th>
							<th class="hidden text-right md:table-cell">{m.books_col_other_fees()}</th>
							<th class="text-right">{m.books_col_total_fees()}</th>
						</tr>
					</thead>
					<tbody>
						{#each result.rows as row (row.month)}
							<tr>
								<td>{row.month}</td>
								<td class="hidden text-right tabular-nums md:table-cell">{row.transactions}</td>
								<td class="text-right tabular-nums">{formatMoney(row.processingFeeCents)}</td>
								<td class="text-right tabular-nums">{formatMoney(row.disputeFeeCents)}</td>
								<td class="hidden text-right tabular-nums md:table-cell">
									{formatMoney(row.otherFeeCents)}
								</td>
								<td class="text-right tabular-nums">{formatMoney(row.totalCents)}</td>
							</tr>
						{/each}
					</tbody>
				{/if}
			</table>
		</div>
		{#if result.report === 'liabilities' && result.rows.some((row) => row.approximate)}
			<p class="mt-2 text-xs text-base-content-muted">{m.books_liab_approximate_note()}</p>
		{/if}
		{#if result.report === 'fees'}
			{#if result.provider === 'mock'}
				<p class="mt-2 text-xs text-base-content-muted">{m.books_fees_mock()}</p>
			{:else if result.gaps.length > 0}
				<p class="mt-2 text-xs text-warning">
					{m.books_fees_gap({ months: result.gaps.join(', ') })}
				</p>
			{/if}
		{/if}
	{/if}
{/if}
