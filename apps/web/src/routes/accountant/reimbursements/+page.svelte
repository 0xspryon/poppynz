<script lang="ts">
	/** The reimbursements and obligations ledger (Tier 3 step 5): one list of
	 * what Poppynz owes or is owed, with filters, totals, CSV and a detail
	 * drawer. Read by permission (`reimbursements`); notes and reconciled
	 * marks by permission too. */
	import {
		accountantErrorText,
		getAccountantAccess,
		listReimbursements,
		reimbursementStatusLabel,
		reimbursementStatusTone,
		reimbursementTypeLabel,
		reimbursementsCsvUrl,
		REIMBURSEMENT_STATUSES,
		REIMBURSEMENT_TYPES,
		type Reimbursement,
		type ReimbursementFilter,
		type ReimbursementTotals
	} from '$lib/api/accountant';
	import ReimbursementDrawer from '$lib/components/accountant/ReimbursementDrawer.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDate, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	let type = $state('');
	let status = $state('');
	let from = $state('');
	let to = $state('');
	let party = $state('');
	let contract = $state('');
	/** The filters last applied (what the list and the CSV show). */
	let applied = $state<ReimbursementFilter>({});

	let items = $state.raw<Array<Reimbursement>>([]);
	let totals = $state.raw<ReimbursementTotals | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);
	let openKey = $state<string | null>(null);
	let canNote = $state(false);
	let canReconcile = $state(false);

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		const result = await listReimbursements(applied);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			items = result.data.items;
			totals = result.data.totals;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(accountantErrorText(result.error));
		}
	}

	$effect(() => {
		void load();
		void getAccountantAccess().then((result) => {
			if (result.ok) {
				canNote = result.data.reimbursementsNote;
				canReconcile = result.data.reimbursementsReconcile;
			}
		});
	});

	function apply(event: SubmitEvent) {
		event.preventDefault();
		applied = { type, status, from, to, party, contract };
		loading = true;
		void load();
	}

	function reset() {
		type = status = from = to = party = contract = '';
		applied = {};
		loading = true;
		void load();
	}

	const csvHref = $derived(reimbursementsCsvUrl(applied));
</script>

<svelte:head>
	<title>{m.books_reimbursements_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.books_reimbursements_heading()}
	</h1>
	<p class="max-w-3xl text-sm text-base-content-muted">{m.books_reimbursements_intro()}</p>
</div>

<form
	class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
	onsubmit={apply}
	data-testid="reimbursement-filters"
>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_type()}</span>
		<select class="select-bordered select w-full select-sm" bind:value={type}>
			<option value="">{m.books_filter_all()}</option>
			{#each REIMBURSEMENT_TYPES as value (value)}
				<option {value}>{reimbursementTypeLabel(value)}</option>
			{/each}
		</select>
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_status()}</span>
		<select class="select-bordered select w-full select-sm" bind:value={status}>
			<option value="">{m.books_filter_all()}</option>
			{#each REIMBURSEMENT_STATUSES as value (value)}
				<option {value}>{reimbursementStatusLabel(value)}</option>
			{/each}
		</select>
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_from()}</span>
		<input type="date" class="input-bordered input w-full input-sm" bind:value={from} />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_to()}</span>
		<input type="date" class="input-bordered input w-full input-sm" bind:value={to} />
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_party()}</span>
		<input
			class="input-bordered input w-full input-sm"
			placeholder={m.books_filter_party_placeholder()}
			bind:value={party}
		/>
	</label>
	<label class="flex flex-col gap-1">
		<span class="text-sm font-medium">{m.books_filter_contract()}</span>
		<input class="input-bordered input w-full input-sm" bind:value={contract} />
	</label>
	<div class="flex flex-wrap items-end gap-2">
		<button type="submit" class="btn btn-sm btn-primary">{m.books_filter_apply()}</button>
		<button type="button" class="btn btn-ghost btn-sm" onclick={reset}>
			{m.books_filter_reset()}
		</button>
		<a class="btn btn-outline btn-sm" href={csvHref} download rel="external">
			<i class="las la-file-csv" aria-hidden="true"></i>
			{m.books_export_csv()}
		</a>
	</div>
</form>

{#if totals}
	<div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="reimbursement-totals">
		<div class="rounded-xl border border-card-border bg-base-100 px-4 py-3">
			<p class="text-xs text-base-content-muted">{m.books_totals_payable()}</p>
			<p class="text-lg font-semibold tabular-nums">{formatMoney(totals.payableCents)}</p>
			<p class="text-xs text-base-content-muted">
				{m.books_totals_outstanding({ amount: formatMoney(totals.outstandingPayableCents) })}
			</p>
		</div>
		<div class="rounded-xl border border-card-border bg-base-100 px-4 py-3">
			<p class="text-xs text-base-content-muted">{m.books_totals_receivable()}</p>
			<p class="text-lg font-semibold tabular-nums">{formatMoney(totals.receivableCents)}</p>
			<p class="text-xs text-base-content-muted">
				{m.books_totals_outstanding({ amount: formatMoney(totals.outstandingReceivableCents) })}
			</p>
		</div>
		<div class="rounded-xl border border-card-border bg-base-100 px-4 py-3">
			<p class="text-xs text-base-content-muted">{m.books_totals_cost()}</p>
			<p class="text-lg font-semibold tabular-nums">{formatMoney(totals.costCents)}</p>
			<p class="text-xs text-base-content-muted">
				{m.books_totals_count({ count: String(totals.count) })}
			</p>
		</div>
	</div>
{/if}

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed}
	<p class="text-sm text-base-content-muted">{m.books_load_failed()}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="text-sm text-base-content-muted">{m.books_empty()}</p>
	</div>
{:else}
	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table table-sm" data-testid="reimbursement-table">
			<thead>
				<tr>
					<th>{m.books_col_date()}</th>
					<th>{m.books_col_type()}</th>
					<th>{m.books_col_status()}</th>
					<th class="text-right">{m.books_col_amount()}</th>
					<th class="hidden text-right md:table-cell">{m.books_col_outstanding()}</th>
					<th class="hidden md:table-cell">{m.books_col_parties()}</th>
					<th class="hidden lg:table-cell">{m.books_col_session()}</th>
					<th class="hidden xl:table-cell">{m.books_col_reference()}</th>
					<th><span class="sr-only">{m.books_open_item()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each items as item (item.key)}
					<tr class="hover" data-testid="reimbursement-row">
						<td class="whitespace-nowrap">{formatDate(item.occurredAt)}</td>
						<td>{reimbursementTypeLabel(item.type)}</td>
						<td>
							<StatusChip
								status={reimbursementStatusTone(item.status)}
								label={reimbursementStatusLabel(item.status)}
							/>
						</td>
						<td class="text-right tabular-nums">{formatMoney(item.amountCents)}</td>
						<td class="hidden text-right tabular-nums md:table-cell">
							{formatMoney(item.outstandingCents)}
						</td>
						<td class="hidden md:table-cell">
							{item.familyName ?? '—'} · {item.helperName ?? '—'}
						</td>
						<td class="hidden lg:table-cell">
							{#if item.sessionDate}{formatDateWithWeekday(item.sessionDate)}{:else}—{/if}
						</td>
						<td class="hidden font-mono text-xs xl:table-cell">
							{item.providerObject?.reference ?? '—'}
						</td>
						<td>
							<button
								type="button"
								class="btn btn-ghost btn-xs"
								onclick={() => (openKey = item.key)}
								data-testid="reimbursement-open"
							>
								{m.books_open_item()}
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if openKey}
	<ReimbursementDrawer
		itemKey={openKey}
		{canNote}
		{canReconcile}
		onclose={() => (openKey = null)}
		onchange={() => void load()}
	/>
{/if}
