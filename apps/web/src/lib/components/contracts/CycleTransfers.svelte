<script lang="ts">
	/** The helper's transfers of one cycle (Tier 3 step 2): the first, then
	 * any follow-up (a session decided later), each with its status, amount,
	 * what a refund took back from it, and its date. */
	import type { ContractCycleDetail } from '$lib/api/contracts';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDateTime } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { cycleTransferChip } from '$lib/session-money';

	interface Props {
		transfers: ContractCycleDetail['transfers'];
	}

	let { transfers }: Props = $props();
</script>

<section
	class="rounded-xl border border-card-border bg-base-100 px-5 py-4"
	data-testid="cycle-transfers"
>
	<h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{m.transfers_cycle_heading()}
	</h2>
	{#if transfers.length === 0}
		<p class="text-[12.5px] text-base-content-muted">{m.transfers_cycle_none()}</p>
	{:else}
		<ul class="flex flex-col gap-2.5 text-[13px]">
			{#each transfers as transfer (transfer.id)}
				{@const chip = cycleTransferChip(transfer.status)}
				<li class="flex flex-col gap-0.5" data-testid="cycle-transfer">
					<div class="flex items-center justify-between gap-2">
						<span class="font-semibold text-base-content">
							{m.transfers_number({ number: transfer.sequence })}
						</span>
						<StatusChip status={chip.status} label={chip.label} />
					</div>
					{#if transfer.amountCents !== null}
						<div class="flex justify-between gap-3">
							<span class="text-base-content-muted">{m.transfers_amount()}</span>
							<span class="tabular-nums">{formatMoney(transfer.amountCents)}</span>
						</div>
					{/if}
					{#if transfer.recoveredCents}
						<div class="flex justify-between gap-3">
							<span class="text-base-content-muted">{m.transfers_recovered()}</span>
							<span class="tabular-nums">−{formatMoney(transfer.recoveredCents)}</span>
						</div>
					{/if}
					<span class="text-[11px] text-outline">
						{transfer.sentAt
							? m.transfers_sent_on({ when: formatDateTime(transfer.sentAt) })
							: m.transfers_due_on({ when: formatDateTime(transfer.dueAt) })}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
