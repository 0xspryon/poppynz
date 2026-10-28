<script lang="ts">
	/** The session refunds of one contract charge (Tier 3 step 2): which
	 * session, the status, the amount, and a link to its receipt (credit
	 * note). */
	import { resolve } from '$app/paths';
	import type { BillingPayment } from '$lib/api/billing';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDate, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { refundStatusChip } from '$lib/session-money';

	interface Props {
		refunds: BillingPayment['refunds'];
	}

	let { refunds }: Props = $props();
</script>

<ul class="flex flex-col gap-1.5" data-testid="payment-refunds">
	{#each refunds as refund (refund.id)}
		{@const chip = refundStatusChip(refund.status)}
		<li
			class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]"
			data-testid="payment-refund"
		>
			<i class="las la-undo-alt text-outline" aria-hidden="true"></i>
			<span class="min-w-0 flex-1 text-base-content">
				{refund.sessionDate
					? m.refunds_billing_line({
							date: formatDateWithWeekday(refund.sessionDate),
							service: refund.serviceName ?? '—'
						})
					: m.refunds_billing_line_no_session({ date: formatDate(refund.createdAt) })}
			</span>
			<span class="tabular-nums text-base-content">−{formatMoney(refund.totalCents)}</span>
			<StatusChip status={chip.status} label={chip.label} />
			{#if refund.status === 'succeeded' || refund.status === 'pending'}
				<a class="link text-sm" href={resolve('/family/billing/refunds/[id]', { id: refund.id })}>
					{m.family_billing_receipt()}
				</a>
			{/if}
			{#if refund.status === 'failed'}
				<span class="w-full text-error">{m.money_session_refund_failed_note()}</span>
			{/if}
		</li>
	{/each}
</ul>
