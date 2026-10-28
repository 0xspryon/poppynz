<script lang="ts">
	/** Reconciliation with Stripe (Tier 3 step 5): the imported balance
	 * transactions of a period, how they matched our records, our records
	 * Stripe didn't list, the runs, an on-demand import and resolving an
	 * unmatched item with a note. By permission (`reconciliation`). */
	import {
		accountantErrorText,
		getAccountantAccess,
		getReconciliation,
		matchKindLabel,
		reconciliationCsvUrl,
		reconciliationNoteText,
		reconciliationRunErrorText,
		reconciliationStatusLabel,
		resolveReconciliationItem,
		runReconciliation,
		runStatusLabel,
		type ReconciliationRow,
		type ReconciliationView
	} from '$lib/api/accountant';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDate, formatDateTime } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const pad = (value: number) => String(value).padStart(2, '0');
	const now = new Date();
	const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
	const iso = (date: Date) =>
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

	let from = $state(iso(monthAgo));
	let to = $state(iso(now));
	let view = $state<'exceptions' | 'all'>('exceptions');
	let data = $state.raw<ReconciliationView | null>(null);
	let loading = $state(true);
	let running = $state(false);
	let busy = $state(false);
	let canRun = $state(false);
	let canResolve = $state(false);
	let resolving = $state<ReconciliationRow | null>(null);
	let note = $state('');

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		loading = true;
		const result = await getReconciliation(from, to, view);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) data = result.data;
		else toast.error(accountantErrorText(result.error));
	}

	$effect(() => {
		void load();
		void getAccountantAccess().then((result) => {
			if (result.ok) {
				canRun = result.data.reconciliationRun;
				canResolve = result.data.reconciliationResolve;
			}
		});
	});

	function show(event: SubmitEvent) {
		event.preventDefault();
		void load();
	}

	async function importNow() {
		if (running) return;
		running = true;
		const result = await runReconciliation(from, to);
		running = false;
		if (!result.ok) {
			toast.error(accountantErrorText(result.error));
			return;
		}
		const run = result.data.run;
		if (run.status === 'failed') {
			toast.error(
				m.books_recon_run_failed({ error: reconciliationRunErrorText(run.error) || '—' })
			);
		} else {
			toast.success(
				m.books_recon_run_done({
					imported: String(run.imported),
					matched: String(run.matched),
					unmatched: String(run.unmatched)
				})
			);
		}
		await load();
	}

	async function submitResolve() {
		if (!resolving || busy) return;
		if (note.trim() === '') {
			toast.error(m.books_error_invalid());
			return;
		}
		busy = true;
		const reopen = resolving.status === 'resolved';
		const result = await resolveReconciliationItem(resolving.key, note.trim(), !reopen);
		busy = false;
		resolving = null;
		if (result.ok) {
			toast.success(reopen ? m.books_recon_reopened_toast() : m.books_recon_resolved_toast());
			await load();
		} else toast.error(accountantErrorText(result.error));
	}

	const tone = (status: string) =>
		status === 'matched' ? 'approved' : status === 'resolved' ? 'complete' : 'rejected';
	const csvHref = $derived(reconciliationCsvUrl(from, to, view));
</script>

<svelte:head>
	<title>{m.books_recon_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.books_recon_heading()}
	</h1>
	<p class="max-w-3xl text-sm text-base-content-muted">{m.books_recon_intro()}</p>
</div>

<form class="mb-4 flex flex-wrap items-end gap-3" onsubmit={show}>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_from()}</span>
		<input type="date" class="input-bordered input input-sm" bind:value={from} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_to()}</span>
		<input type="date" class="input-bordered input input-sm" bind:value={to} required />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_recon_view()}</span>
		<select class="select-bordered select select-sm" bind:value={view}>
			<option value="exceptions">{m.books_recon_view_exceptions()}</option>
			<option value="all">{m.books_recon_view_all()}</option>
		</select>
	</label>
	<button type="submit" class="btn btn-outline btn-sm">{m.books_recon_load()}</button>
	{#if canRun}
		<button
			type="button"
			class="btn btn-sm btn-primary"
			disabled={running}
			onclick={() => void importNow()}
			data-testid="reconciliation-run"
		>
			{#if running}<span class="loading loading-xs loading-spinner"></span>{/if}
			{m.books_recon_run()}
		</button>
	{/if}
	<a class="btn btn-outline btn-sm" href={csvHref} download rel="external">
		<i class="las la-file-csv" aria-hidden="true"></i>
		{m.books_export_csv()}
	</a>
</form>

{#if loading && !data}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if data}
	{#if data.provider === 'mock'}
		<p class="mb-4 text-xs text-base-content-muted">{m.books_recon_mock_note()}</p>
	{/if}
	<dl
		class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
		data-testid="reconciliation-summary"
	>
		{#each [[m.books_recon_summary_imported(), data.summary.imported], [m.books_recon_summary_matched(), data.summary.matched], [m.books_recon_summary_unmatched(), data.summary.unmatched], [m.books_recon_summary_mismatch(), data.summary.mismatch], [m.books_recon_summary_resolved(), data.summary.resolved], [m.books_recon_summary_ours(), data.summary.oursUnmatched]] as [label, value] (label)}
			<div class="rounded-xl border border-card-border bg-base-100 px-4 py-3">
				<dt class="text-xs text-base-content-muted">{label}</dt>
				<dd class="text-lg font-semibold tabular-nums">{value}</dd>
			</div>
		{/each}
	</dl>

	{#if data.items.length === 0}
		<div class="mb-6 rounded-xl border border-card-border bg-base-100 p-10 text-center">
			<p class="text-sm text-base-content-muted">{m.books_recon_empty()}</p>
		</div>
	{:else}
		<div class="mb-6 overflow-x-auto rounded-xl border border-card-border bg-base-100">
			<table class="table table-sm" data-testid="reconciliation-table">
				<thead>
					<tr>
						<th>{m.books_col_date()}</th>
						<th>{m.books_recon_col_side()}</th>
						<th>{m.books_recon_col_kind()}</th>
						<th class="hidden md:table-cell">{m.books_recon_col_reference()}</th>
						<th class="text-right">{m.books_col_amount()}</th>
						<th class="hidden text-right lg:table-cell">{m.books_recon_col_fee()}</th>
						<th>{m.books_col_status()}</th>
						<th class="hidden lg:table-cell">{m.books_recon_col_note()}</th>
						<th><span class="sr-only">{m.books_recon_resolve()}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as item (item.key)}
						<tr data-testid="reconciliation-row">
							<td class="whitespace-nowrap">{formatDate(item.occurredAt)}</td>
							<td>
								{item.side === 'provider'
									? m.books_recon_side_provider()
									: m.books_recon_side_ours()}
							</td>
							<td>
								{item.side === 'ours' ? matchKindLabel(item.kind) : item.kind}
								{#if item.matchKind && item.side === 'provider'}
									<span class="block text-[11px] text-base-content-muted">
										→ {matchKindLabel(item.matchKind)}
									</span>
								{/if}
							</td>
							<td class="hidden font-mono text-xs break-all md:table-cell"
								>{item.reference ?? '—'}</td
							>
							<td class="text-right tabular-nums">{formatMoney(item.amountCents)}</td>
							<td class="hidden text-right tabular-nums lg:table-cell"
								>{formatMoney(item.feeCents)}</td
							>
							<td>
								<StatusChip
									status={tone(item.status)}
									label={reconciliationStatusLabel(item.status)}
								/>
							</td>
							<td class="hidden max-w-xs text-xs break-words lg:table-cell">
								{#if item.resolution}
									{m.books_recon_resolved_by({ note: item.resolution.note ?? '—' })}
								{:else}
									{reconciliationNoteText(item.note)}
								{/if}
							</td>
							<td>
								{#if canResolve && item.status !== 'matched'}
									<button
										type="button"
										class="btn btn-ghost btn-xs"
										onclick={() => {
											resolving = item;
											note = '';
										}}
										data-testid="reconciliation-resolve"
									>
										{item.status === 'resolved' ? m.books_recon_reopen() : m.books_recon_resolve()}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<h2 class="mb-2 font-semibold">{m.books_recon_runs()}</h2>
	{#if data.runs.length === 0}
		<p class="text-sm text-base-content-muted">{m.books_recon_runs_empty()}</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
			<table class="table table-sm">
				<thead>
					<tr>
						<th>{m.books_recon_col_started()}</th>
						<th class="hidden md:table-cell">{m.books_recon_col_period()}</th>
						<th>{m.books_col_status()}</th>
						<th>{m.books_recon_col_result()}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.runs as run (run.id)}
						<tr>
							<td class="whitespace-nowrap">
								{formatDateTime(run.startedAt)}
								<span class="block text-[11px] text-base-content-muted">
									{run.trigger === 'schedule'
										? m.books_recon_trigger_schedule()
										: m.books_recon_trigger_manual()}
								</span>
							</td>
							<td class="hidden md:table-cell">
								{formatDate(run.periodFrom)} – {formatDate(run.periodTo)}
							</td>
							<td>{runStatusLabel(run.status)}</td>
							<td class="text-xs">
								{m.books_recon_run_counts({
									imported: String(run.importedCount),
									matched: String(run.matchedCount),
									unmatched: String(run.unmatchedCount),
									exact: String(run.payoutsExactCount)
								})}
								{#if run.error}<span class="block text-error"
										>{reconciliationRunErrorText(run.error)}</span
									>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}

{#if resolving}
	<ConfirmDialog
		open={resolving !== null}
		title={resolving.status === 'resolved' ? m.books_recon_reopen() : m.books_recon_resolve_title()}
		body={m.books_recon_resolve_body()}
		confirmLabel={resolving.status === 'resolved'
			? m.books_recon_reopen()
			: m.books_recon_resolve()}
		cancelLabel={m.common_back()}
		confirmClass="btn-primary"
		{busy}
		onconfirm={() => void submitResolve()}
		oncancel={() => (resolving = null)}
	>
		<label class="flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold text-base-content">{m.books_recon_resolve_note()}</span>
			<textarea
				class="textarea textarea-sm w-full"
				rows="3"
				maxlength="2000"
				bind:value={note}
				data-testid="reconciliation-resolve-note"
			></textarea>
		</label>
	</ConfirmDialog>
{/if}
