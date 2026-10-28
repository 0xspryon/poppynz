<script lang="ts">
	/** Where one session's money stands (Tier 3 step 2, spec §10), from the
	 * viewer's side: the family's refunds, the helper's transfer, and how the
	 * session was settled when worth saying ("Left out of the charge"). */
	import type { ContractCycleSession } from '$lib/api/contracts';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { cycleTransferChip, mechanismLabel, refundStatusChip } from '$lib/session-money';

	interface Props {
		money: ContractCycleSession['money'] | undefined;
		viewerSide: 'family' | 'provider';
	}

	let { money, viewerSide }: Props = $props();

	const mechanism = $derived(money ? mechanismLabel(money.mechanism, viewerSide) : null);
	const transfer = $derived(viewerSide === 'provider' ? (money?.transfer ?? null) : null);
	const refunds = $derived(viewerSide === 'family' ? (money?.refunds ?? []) : []);
	/** The helper isn't paid for a session left out of the charge. */
	const notPaid = $derived(
		viewerSide === 'provider' && transfer === null && money?.mechanism === 'excluded'
	);
	const shown = $derived(mechanism !== null || transfer !== null || refunds.length > 0);
</script>

{#if shown}
	<div class="flex flex-col gap-1 text-[12px]" data-testid="session-money-status">
		{#if mechanism && !notPaid && !transfer?.held}
			<span class="text-base-content-muted">{mechanism}</span>
		{/if}
		{#if notPaid}
			<span class="text-base-content-muted">{m.money_session_not_paid()}</span>
		{/if}
		{#each refunds as refund (refund.id)}
			{@const chip = refundStatusChip(refund.status)}
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="text-base-content">
					{m.money_session_refund({ amount: formatMoney(refund.totalCents) })}
				</span>
				<StatusChip status={chip.status} label={chip.label} />
				{#if refund.status === 'failed'}
					<span class="text-error">{m.money_session_refund_failed_note()}</span>
				{/if}
			</div>
		{/each}
		{#if transfer}
			{#if transfer.held}
				<span class="text-base-content-muted">{m.money_session_transfer_held()}</span>
			{:else}
				{@const chip = cycleTransferChip(transfer.status)}
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="text-base-content">
						{m.money_session_transfer({ amount: formatMoney(transfer.amountCents) })}
					</span>
					<StatusChip status={chip.status} label={chip.label} />
				</div>
			{/if}
		{/if}
	</div>
{/if}
