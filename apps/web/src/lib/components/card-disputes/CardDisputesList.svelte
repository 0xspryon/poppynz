<script lang="ts">
	/** Card disputes (Tier 3 step 4): the list, filtered by status and by
	 * when the evidence is due. Admins open each one; the accountant reads
	 * the list and what Poppynz bears (`readonly`). Amounts are shown only
	 * when the API returns them (permission `cardDispute: finance`). */
	import { resolve } from '$app/paths';
	import {
		listCardDisputes,
		type CardDisputeDueFilter,
		type CardDisputeListItem,
		type CardDisputeStatusFilter,
		type CardDisputeTotals
	} from '$lib/api/card-disputes';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import {
		cardDisputeErrorMessage,
		cardDisputeReasonLabel,
		cardDisputeScopeLabel,
		cardDisputeStatusChip,
		cardDisputeStatusLabel,
		cardDisputeTriageLabel
	} from '$lib/card-disputes';
	import { formatDateTime } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		readonly?: boolean;
	}
	let { readonly = false }: Props = $props();

	let status = $state<CardDisputeStatusFilter>('open');
	let due = $state<CardDisputeDueFilter>('');
	let items = $state<Array<CardDisputeListItem>>([]);
	let totals = $state<CardDisputeTotals>(null);
	let loading = $state(true);
	let loadFailed = $state(false);

	let seq = 0;
	async function load(filter: { status: CardDisputeStatusFilter; due: CardDisputeDueFilter }) {
		seq += 1;
		const mine = seq;
		const result = await listCardDisputes(filter);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			items = result.data.disputes;
			totals = result.data.totals;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(cardDisputeErrorMessage(result.error));
		}
	}

	$effect(() => {
		void load({ status, due });
	});

	const overdue = (item: CardDisputeListItem) =>
		item.closedAt === null &&
		item.evidenceDueBy !== null &&
		new Date(item.evidenceDueBy).getTime() <= Date.now();
</script>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.admin_card_disputes_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">
		{readonly ? m.admin_card_disputes_intro_readonly() : m.admin_card_disputes_intro()}
	</p>
</div>

<div class="mb-4 flex flex-wrap gap-3">
	<label class="flex flex-col gap-1 text-[12.5px]">
		<span class="font-semibold text-base-content">{m.admin_card_disputes_filter_status()}</span>
		<select class="select select-sm" bind:value={status} data-testid="card-disputes-status">
			<option value="open">{m.admin_card_disputes_filter_open()}</option>
			<option value="closed">{m.admin_card_disputes_filter_closed()}</option>
			<option value="all">{m.admin_card_disputes_filter_all()}</option>
		</select>
	</label>
	<label class="flex flex-col gap-1 text-[12.5px]">
		<span class="font-semibold text-base-content">{m.admin_card_disputes_filter_due()}</span>
		<select class="select select-sm" bind:value={due} data-testid="card-disputes-due">
			<option value="">{m.admin_card_disputes_filter_due_any()}</option>
			<option value="overdue">{m.admin_card_disputes_filter_due_overdue()}</option>
			<option value="week">{m.admin_card_disputes_filter_due_week()}</option>
		</select>
	</label>
</div>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed}
	<p class="text-sm text-base-content-muted">{m.admin_card_disputes_load_failed()}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="text-sm text-base-content-muted">{m.admin_card_disputes_empty()}</p>
	</div>
{:else}
	{#if totals}
		<p class="mb-3 text-sm text-base-content" data-testid="card-disputes-totals">
			{m.admin_card_disputes_totals({
				net: formatMoney(totals.netCents),
				fees: formatMoney(totals.feeCents)
			})}
		</p>
	{/if}
	<ul class="flex flex-col gap-2" data-testid="card-disputes">
		{#each items as item (item.id)}
			<li
				class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-base-100 px-4 py-3"
				data-testid="card-dispute"
			>
				<div class="min-w-0 flex-1">
					<p class="font-semibold text-base-content">
						{formatMoney(item.amountCents)}
						<span class="font-normal text-base-content-muted">
							· {item.familyName} · {cardDisputeReasonLabel(item.reason)} · {cardDisputeScopeLabel(
								item.scope
							)}
						</span>
					</p>
					<p class="text-[12px] text-outline">
						{#if item.closedAt}
							{m.admin_card_disputes_closed_on({ when: formatDateTime(item.closedAt) })}
						{:else if item.evidenceDueBy}
							<span class={overdue(item) ? 'text-error' : ''}>
								{overdue(item)
									? m.admin_card_disputes_overdue({ when: formatDateTime(item.evidenceDueBy) })
									: m.admin_card_disputes_due({ when: formatDateTime(item.evidenceDueBy) })}
							</span>
						{/if}
						· {cardDisputeTriageLabel(item.triage)}
					</p>
					{#if item.money}
						<p class="text-[12px] text-base-content" data-testid="card-dispute-borne">
							{m.admin_card_disputes_borne({ amount: formatMoney(item.money.netCents) })}
						</p>
					{/if}
				</div>
				<StatusChip
					status={cardDisputeStatusChip(item.status)}
					label={cardDisputeStatusLabel(item.status)}
				/>
				{#if !readonly}
					<a
						class="btn btn-outline btn-sm"
						href={resolve('/admin/card-disputes/[id]', { id: item.id })}
						data-testid="card-dispute-open"
					>
						{m.admin_card_disputes_open()}
					</a>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
