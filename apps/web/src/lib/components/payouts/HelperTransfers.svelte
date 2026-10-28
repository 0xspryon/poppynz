<script lang="ts">
	/** The helper's transfers (Tier 3 step 2): one per cycle, plus any
	 * follow-up, each with the family, the cycle's dates, its status, the
	 * amount and what a refund took back from it — and, expanded, what it
	 * paid per session (held sessions marked, recoveries as deductions). */
	import { listHelperTransfers, type HelperTransfer } from '$lib/api/session-money';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDate, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
	import { helperTransferChip } from '$lib/session-money';
	import { onMount } from 'svelte';

	let transfers = $state<Array<HelperTransfer> | null>(null);
	let loading = $state(true);
	let open = $state<Record<string, boolean>>({});

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		const result = await listHelperTransfers();
		if (mine !== seq) return;
		loading = false;
		if (result.ok) transfers = result.data.transfers;
	}

	onMount(() => {
		void load();
		// A transfer was sent or held, or a refund recovered from one: refetch.
		return notifications.on('contract.billing', () => void load());
	});

	const dates = (transfer: HelperTransfer) =>
		transfer.cycleStartsOn && transfer.cycleEndsOn
			? transfer.cycleStartsOn === transfer.cycleEndsOn
				? formatDateWithWeekday(transfer.cycleStartsOn)
				: `${formatDateWithWeekday(transfer.cycleStartsOn)} – ${formatDateWithWeekday(transfer.cycleEndsOn)}`
			: null;

	const when = (transfer: HelperTransfer) =>
		transfer.paidAt
			? m.transfers_paid_on({ when: formatDate(transfer.paidAt) })
			: transfer.sentAt
				? m.transfers_sent_on({ when: formatDate(transfer.sentAt) })
				: m.transfers_due_on({ when: formatDate(transfer.dueAt) });
</script>

<section class="mt-8" aria-live="polite" data-testid="helper-transfers">
	<h2 class="mb-1 text-lg font-semibold text-base-content">{m.transfers_title()}</h2>
	<p class="mb-3 text-sm text-base-content-muted">{m.transfers_intro()}</p>

	{#if loading}
		<span class="loading loading-spinner loading-md" aria-label={m.common_loading()}></span>
	{:else if transfers === null}
		<p class="text-sm text-base-content-muted">{m.transfers_load_failed()}</p>
	{:else if transfers.length === 0}
		<p class="text-sm text-base-content-muted">{m.transfers_none()}</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each transfers as transfer (transfer.id)}
				{@const chip = helperTransferChip(transfer.status)}
				{@const range = dates(transfer)}
				<li
					class="rounded-xl border border-card-border bg-base-100 px-4 py-3"
					data-testid="helper-transfer"
				>
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
						<div class="min-w-0 flex-1">
							<p class="font-semibold text-base-content">
								{transfer.familyName ?? m.transfers_family_unknown()}
								{#if transfer.sequence > 1}
									<span class="text-[12px] font-normal text-outline">
										· {m.transfers_follow_up({ number: transfer.sequence })}
									</span>
								{/if}
							</p>
							{#if range}
								<p class="text-[12.5px] text-base-content-muted">{range}</p>
							{/if}
							<p class="text-[12px] text-outline">{when(transfer)}</p>
						</div>
						<div class="flex flex-col items-end gap-1">
							<StatusChip status={chip.status} label={chip.label} />
							{#if transfer.amountCents !== null}
								<span class="font-semibold tabular-nums text-base-content">
									{formatMoney(transfer.amountCents)}
								</span>
							{/if}
						</div>
					</div>
					{#if transfer.recoveredCents}
						<p class="mt-1 text-[12px] text-base-content-muted">
							{m.transfers_recovered_note({ amount: formatMoney(transfer.recoveredCents) })}
						</p>
					{/if}
					{#if transfer.items.length > 0}
						<button
							type="button"
							class="btn mt-1 gap-1 px-0 btn-ghost btn-xs text-secondary"
							aria-expanded={open[transfer.id] === true}
							onclick={() => (open[transfer.id] = !open[transfer.id])}
							data-testid="helper-transfer-toggle"
						>
							<i
								class={['las', open[transfer.id] ? 'la-angle-up' : 'la-angle-down']}
								aria-hidden="true"
							></i>
							{open[transfer.id] ? m.transfers_hide_breakdown() : m.transfers_show_breakdown()}
						</button>
						{#if open[transfer.id]}
							<ul
								class="mt-1 flex flex-col gap-1 border-t border-base-300 pt-2 text-[12.5px]"
								data-testid="helper-transfer-items"
							>
								{#each transfer.items as item, index (index)}
									<li class="flex justify-between gap-3">
										<span class="text-base-content-muted">
											{#if item.kind === 'recovery'}
												{item.sessionDate
													? m.transfers_item_recovery_for({
															date: formatDateWithWeekday(item.sessionDate)
														})
													: m.transfers_item_recovery()}
											{:else}
												{item.sessionDate ? formatDateWithWeekday(item.sessionDate) : '—'}
												{#if item.serviceName}· {item.serviceName}{/if}
												{#if item.kind === 'held'}
													<span class="font-semibold text-accent">
														· {m.transfers_item_held()}
													</span>
												{/if}
											{/if}
										</span>
										<span class="tabular-nums">
											{item.amountCents < 0
												? `−${formatMoney(-item.amountCents)}`
												: formatMoney(item.amountCents)}
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
