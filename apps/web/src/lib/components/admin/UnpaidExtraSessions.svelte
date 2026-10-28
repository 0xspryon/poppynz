<script lang="ts">
	/** Admins (Tier 3 step 3): extra sessions whose own charge hasn't gone
	 * through — declined and retried, or in flight — with the attempts, the
	 * next automatic retry and whether the unpaid incident was raised
	 * (`CONTRACT_EXTRA_SESSION_UNPAID_ALERT_DAYS` after it was due). The
	 * regular contract is never suspended for them. Read-only: a new card
	 * retries the charge, and the family is the one to fix it. */
	import { listUnpaidExtraSessions, type UnpaidExtraSession } from '$lib/api/extra-sessions';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';

	let items = $state<Array<UnpaidExtraSession> | null>(null);

	$effect(() => {
		void (async () => {
			const result = await listUnpaidExtraSessions();
			items = result.ok ? result.data.extraSessions : null;
		})();
	});
</script>

{#if items !== null}
	<section class="mt-8" data-testid="unpaid-extra-sessions">
		<h2 class="mb-1 font-display text-lg font-bold text-base-content">
			{m.admin_unpaid_extra_heading()}
		</h2>
		<p class="mb-3 text-sm text-base-content-muted">{m.admin_unpaid_extra_intro()}</p>
		{#if items.length === 0}
			<div class="rounded-xl border border-card-border bg-base-100 p-6 text-center">
				<p class="text-sm text-base-content-muted">{m.admin_unpaid_extra_empty()}</p>
			</div>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each items as item (item.id)}
					<li
						class="flex flex-col gap-1 rounded-xl border border-card-border bg-base-100 px-4 py-3 text-[13px]"
						data-testid="unpaid-extra-session"
					>
						<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
							<span class="min-w-0 flex-1 font-medium text-base-content">
								{item.serviceName} · {formatDateWithWeekday(item.date)} · {formatSessionRange({
									weekday: 0,
									startMinutes: item.startMinutes,
									endMinutes: item.endMinutes
								})}
							</span>
							<span class="font-semibold tabular-nums">{formatMoney(item.totalCents)}</span>
							{#if item.alerted}
								<StatusChip status="rejected" label={m.admin_unpaid_extra_alerted()} />
							{/if}
						</div>
						<p class="text-[11.5px] text-outline">
							{m.admin_unpaid_extra_parties({
								family: item.familyName ?? '—',
								helper: item.helperName ?? '—'
							})}
							· {m.admin_unpaid_extra_attempts({ count: item.attempts })}
							·
							{#if item.status === 'charging'}
								{m.admin_unpaid_extra_charging()}
							{:else if item.nextRetryAt}
								{m.admin_unpaid_extra_next_retry({ time: formatDateTime(item.nextRetryAt) })}
							{:else}
								{m.admin_unpaid_extra_no_retry()}
							{/if}
						</p>
						{#if item.lastError}
							<p class="text-[12px] text-error">{item.lastError}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
