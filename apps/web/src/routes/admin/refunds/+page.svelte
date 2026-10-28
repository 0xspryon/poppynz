<script lang="ts">
	/** Failed session refunds (Tier 3 step 2, spec §8): retry one with
	 * Stripe, or mark it handled once settled another way (with a note on
	 * how). Gated by the `refundQueue` permission on the API. */
	import {
		listFailedRefunds,
		markRefundHandled,
		retryRefund,
		type FailedRefund
	} from '$lib/api/admin-money';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { adminMoneyErrorMessage } from '$lib/session-money';
	import { toast } from '$lib/toast.svelte';

	let items = $state<Array<FailedRefund>>([]);
	let loading = $state(true);
	let loadFailed = $state(false);
	let busy = $state(false);
	/** The refund being marked handled. */
	let handling = $state<FailedRefund | null>(null);
	let note = $state('');

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		const result = await listFailedRefunds();
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			items = result.data.refunds;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(adminMoneyErrorMessage(result.error));
		}
	}

	$effect(() => {
		void load();
	});

	async function retry(refund: FailedRefund) {
		if (busy) return;
		busy = true;
		const result = await retryRefund(refund.id);
		busy = false;
		if (result.ok) {
			toast.success(m.admin_money_refund_retried());
		} else {
			toast.error(adminMoneyErrorMessage(result.error));
		}
		await load();
	}

	async function submitHandled() {
		if (!handling || busy) return;
		if (note.trim() === '') {
			toast.error(m.admin_money_error_note_required());
			return;
		}
		busy = true;
		const result = await markRefundHandled(handling.id, note.trim());
		busy = false;
		handling = null;
		if (result.ok) {
			toast.success(m.admin_money_refund_handled());
		} else {
			toast.error(adminMoneyErrorMessage(result.error));
		}
		await load();
	}
</script>

<svelte:head>
	<title>{m.admin_money_refunds_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.admin_money_refunds_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">{m.admin_money_refunds_intro()}</p>
</div>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed}
	<p class="text-sm text-base-content-muted">{m.admin_money_load_failed()}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="text-sm text-base-content-muted">{m.admin_money_refunds_empty()}</p>
	</div>
{:else}
	<ul class="flex flex-col gap-2" data-testid="failed-refunds">
		{#each items as refund (refund.id)}
			<li
				class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-card-border bg-base-100 px-4 py-3"
				data-testid="failed-refund"
			>
				<div class="min-w-0 flex-1">
					<p class="font-semibold text-base-content">
						{formatMoney(refund.totalCents)}
						{#if refund.sessionDate}
							<span class="font-normal text-base-content-muted">
								· {formatDateWithWeekday(refund.sessionDate)}
								{#if refund.serviceName}· {refund.serviceName}{/if}
							</span>
						{/if}
					</p>
					<p class="text-[12px] text-outline">
						{m.admin_money_refund_created({ when: formatDateTime(refund.createdAt) })}
					</p>
					{#if refund.failureReason}
						<p class="text-[12px] text-error">
							{m.admin_money_failure_reason({ reason: refund.failureReason })}
						</p>
					{/if}
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={busy}
						onclick={() => void retry(refund)}
						data-testid="refund-retry"
					>
						<i class="las la-redo-alt" aria-hidden="true"></i>
						{m.admin_money_retry_refund()}
					</button>
					<button
						type="button"
						class="btn btn-sm btn-primary"
						disabled={busy}
						onclick={() => {
							handling = refund;
							note = '';
						}}
						data-testid="refund-handled"
					>
						{m.admin_money_mark_handled()}
					</button>
				</div>
			</li>
		{/each}
	</ul>
{/if}

{#if handling}
	<ConfirmDialog
		open={handling !== null}
		title={m.admin_money_handled_title()}
		body={m.admin_money_handled_body({ amount: formatMoney(handling.totalCents) })}
		confirmLabel={m.admin_money_mark_handled()}
		cancelLabel={m.common_back()}
		confirmClass="btn-primary"
		{busy}
		onconfirm={() => void submitHandled()}
		oncancel={() => (handling = null)}
	>
		<label class="flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold text-base-content">{m.admin_money_field_handled_note()}</span>
			<textarea
				class="textarea textarea-sm w-full"
				rows="3"
				maxlength="2000"
				bind:value={note}
				data-testid="refund-handled-note"
			></textarea>
		</label>
	</ConfirmDialog>
{/if}
