<script lang="ts">
	/** The manual payout queue (Tier 3 step 2, spec §8): transfers Stripe
	 * couldn't make or that wait for review. An admin records a payout made
	 * outside Stripe (Interac e-Transfer, bank transfer, cheque); another
	 * admin approves or rejects it. A refused transfer can also be retried.
	 * Gated by the `payoutQueue` permission on the API. */
	import {
		decideManualPayout,
		listPayoutQueue,
		recordManualPayout,
		retryTransfer,
		type ManualPayout,
		type ManualPayoutMethod,
		type PayoutQueueItem
	} from '$lib/api/admin-money';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDate, formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { centsToDollars, dollarsToCents, formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { adminMoneyErrorMessage } from '$lib/session-money';
	import { toast } from '$lib/toast.svelte';

	let items = $state<Array<PayoutQueueItem>>([]);
	let loading = $state(true);
	let loadFailed = $state(false);
	let busy = $state(false);

	/** The transfer whose manual payout form is open. */
	let recording = $state<PayoutQueueItem | null>(null);
	let method = $state<ManualPayoutMethod>('interac_etransfer');
	let reference = $state('');
	let amount = $state('');
	let reason = $state('');

	/** The manual payout being approved or rejected. */
	let deciding = $state<{ payout: ManualPayout; decision: 'approved' | 'rejected' } | null>(null);
	let decisionNote = $state('');

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		const result = await listPayoutQueue();
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			items = result.data.transfers;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(adminMoneyErrorMessage(result.error));
		}
	}

	$effect(() => {
		void load();
	});

	const methods: ReadonlyArray<ManualPayoutMethod> = [
		'interac_etransfer',
		'bank_transfer',
		'cheque',
		'other'
	];
	const methodLabel = (value: string): string => {
		switch (value) {
			case 'interac_etransfer':
				return m.admin_money_method_interac();
			case 'bank_transfer':
				return m.admin_money_method_bank();
			case 'cheque':
				return m.admin_money_method_cheque();
			default:
				return m.admin_money_method_other();
		}
	};

	const statusChip = (status: PayoutQueueItem['status']): { status: ChipStatus; label: string } => {
		switch (status) {
			case 'paused':
				return { status: 'in-progress', label: m.admin_money_transfer_paused() };
			case 'failed':
				return { status: 'rejected', label: m.admin_money_transfer_failed() };
			default:
				return { status: 'proposed', label: m.admin_money_transfer_manual_review() };
		}
	};
	const payoutChip = (status: ManualPayout['status']): { status: ChipStatus; label: string } => {
		switch (status) {
			case 'pending_approval':
				return { status: 'awaiting-you', label: m.admin_money_payout_pending() };
			case 'approved':
				return { status: 'approved', label: m.admin_money_payout_approved() };
			case 'rejected':
				return { status: 'rejected', label: m.admin_money_payout_rejected() };
		}
	};

	/** A payout can be recorded while nothing is pending or approved. */
	const canRecord = (item: PayoutQueueItem) =>
		(item.status === 'manual_review' || item.status === 'failed') &&
		item.amountCents !== null &&
		!item.manualPayouts.some((payout) => payout.status !== 'rejected');

	const cycleDates = (item: PayoutQueueItem) => {
		if (!item.cycleStartsOn || !item.cycleEndsOn) return '';
		return item.cycleStartsOn === item.cycleEndsOn
			? formatDateWithWeekday(item.cycleStartsOn)
			: `${formatDateWithWeekday(item.cycleStartsOn)} – ${formatDateWithWeekday(item.cycleEndsOn)}`;
	};

	function openRecord(item: PayoutQueueItem) {
		recording = item;
		method = 'interac_etransfer';
		reference = '';
		amount = item.amountCents !== null ? centsToDollars(item.amountCents) : '';
		reason = item.failureReason ?? '';
	}

	async function submitRecord() {
		if (!recording || busy) return;
		const amountCents = dollarsToCents(amount);
		if (amountCents === null) {
			toast.error(m.admin_money_error_amount());
			return;
		}
		if (reference.trim() === '' || reason.trim() === '') {
			toast.error(m.admin_money_error_required());
			return;
		}
		busy = true;
		const result = await recordManualPayout(recording.id, {
			method,
			reference: reference.trim(),
			amountCents,
			reason: reason.trim()
		});
		busy = false;
		if (result.ok) {
			toast.success(m.admin_money_recorded());
			recording = null;
		} else {
			toast.error(adminMoneyErrorMessage(result.error));
		}
		await load();
	}

	async function submitDecision() {
		if (!deciding || busy) return;
		const { payout, decision } = deciding;
		if (decision === 'rejected' && decisionNote.trim() === '') {
			toast.error(m.admin_money_error_note_required());
			return;
		}
		busy = true;
		const result = await decideManualPayout(payout.id, {
			decision,
			note: decisionNote.trim() || null
		});
		busy = false;
		deciding = null;
		if (result.ok) {
			toast.success(decision === 'approved' ? m.admin_money_approved() : m.admin_money_rejected());
		} else {
			toast.error(adminMoneyErrorMessage(result.error));
		}
		await load();
	}

	async function retry(item: PayoutQueueItem) {
		if (busy) return;
		busy = true;
		const result = await retryTransfer(item.id);
		busy = false;
		if (result.ok && result.data.transfer.status === 'failed') {
			// Stripe answered at once and refused it again (it stays listed).
			toast.error(m.admin_money_transfer_refused_again());
		} else if (result.ok) {
			toast.success(m.admin_money_transfer_retried());
		} else {
			toast.error(adminMoneyErrorMessage(result.error));
		}
		await load();
	}
</script>

<svelte:head>
	<title>{m.admin_money_payouts_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.admin_money_payouts_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">{m.admin_money_payouts_intro()}</p>
</div>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if loadFailed}
	<p class="text-sm text-base-content-muted">{m.admin_money_load_failed()}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="text-sm text-base-content-muted">{m.admin_money_payouts_empty()}</p>
	</div>
{:else}
	<ul class="flex flex-col gap-3" data-testid="payout-queue">
		{#each items as item (item.id)}
			{@const chip = statusChip(item.status)}
			<li
				class="flex flex-col gap-2 rounded-xl border border-card-border bg-base-100 px-4 py-3"
				data-testid="payout-queue-item"
			>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
					<div class="min-w-0 flex-1">
						<p class="font-semibold text-base-content">
							{item.helperName}
							<span class="text-[12px] font-normal text-outline">
								· {m.transfers_number({ number: item.sequence })}
							</span>
						</p>
						<p class="text-[12.5px] text-base-content-muted">{cycleDates(item)}</p>
						<p class="text-[12px] text-outline">
							{m.transfers_due_on({ when: formatDate(item.dueAt) })}
						</p>
						{#if item.failureReason}
							<p class="text-[12px] text-error">
								{m.admin_money_failure_reason({ reason: item.failureReason })}
							</p>
						{/if}
					</div>
					<div class="flex flex-col items-end gap-1">
						<StatusChip status={chip.status} label={chip.label} />
						{#if item.amountCents !== null}
							<span class="font-semibold tabular-nums">{formatMoney(item.amountCents)}</span>
						{/if}
					</div>
				</div>

				{#if item.manualPayouts.length > 0}
					<ul class="flex flex-col gap-1.5 border-t border-base-300 pt-2 text-[12.5px]">
						{#each item.manualPayouts as payout (payout.id)}
							{@const pchip = payoutChip(payout.status)}
							<li class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="manual-payout">
								<span class="min-w-0 flex-1 text-base-content">
									{m.admin_money_payout_line({
										method: methodLabel(payout.method),
										reference: payout.reference,
										amount: formatMoney(payout.amountCents),
										when: formatDateTime(payout.recordedAt)
									})}
									<span class="block text-base-content-muted italic">“{payout.reason}”</span>
									{#if payout.decisionNote}
										<span class="block text-outline">
											{m.admin_money_decision_note({ note: payout.decisionNote })}
										</span>
									{/if}
								</span>
								<StatusChip status={pchip.status} label={pchip.label} />
								{#if payout.status === 'pending_approval'}
									<button
										type="button"
										class="btn btn-xs btn-primary"
										disabled={busy}
										onclick={() => {
											deciding = { payout, decision: 'approved' };
											decisionNote = '';
										}}
										data-testid="manual-payout-approve"
									>
										{m.admin_money_approve()}
									</button>
									<button
										type="button"
										class="btn btn-outline btn-xs"
										disabled={busy}
										onclick={() => {
											deciding = { payout, decision: 'rejected' };
											decisionNote = '';
										}}
										data-testid="manual-payout-reject"
									>
										{m.admin_money_reject()}
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<div class="flex flex-wrap gap-2">
					{#if item.status === 'failed'}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							disabled={busy}
							onclick={() => void retry(item)}
							data-testid="transfer-retry"
						>
							<i class="las la-redo-alt" aria-hidden="true"></i>
							{m.admin_money_retry_transfer()}
						</button>
					{/if}
					{#if canRecord(item) && recording?.id !== item.id}
						<button
							type="button"
							class="btn btn-sm btn-primary"
							disabled={busy}
							onclick={() => openRecord(item)}
							data-testid="manual-payout-open"
						>
							{m.admin_money_record()}
						</button>
					{/if}
				</div>

				{#if recording?.id === item.id}
					<form
						class="grid gap-3 rounded-lg border border-card-border bg-base-200 p-3 sm:grid-cols-2"
						onsubmit={(event) => {
							event.preventDefault();
							void submitRecord();
						}}
						data-testid="manual-payout-form"
					>
						<label class="flex flex-col gap-1 text-[12.5px]">
							<span class="font-semibold">{m.admin_money_field_method()}</span>
							<select class="select select-sm w-full" bind:value={method} name="method">
								{#each methods as value (value)}
									<option {value}>{methodLabel(value)}</option>
								{/each}
							</select>
						</label>
						<label class="flex flex-col gap-1 text-[12.5px]">
							<span class="font-semibold">{m.admin_money_field_reference()}</span>
							<input
								class="input input-sm w-full"
								bind:value={reference}
								name="reference"
								maxlength="200"
								required
							/>
						</label>
						<label class="flex flex-col gap-1 text-[12.5px]">
							<span class="font-semibold">{m.admin_money_field_amount()}</span>
							<input
								class="input input-sm w-full"
								bind:value={amount}
								name="amount"
								inputmode="decimal"
								required
							/>
						</label>
						<label class="flex flex-col gap-1 text-[12.5px] sm:col-span-2">
							<span class="font-semibold">{m.admin_money_field_reason()}</span>
							<textarea
								class="textarea textarea-sm w-full"
								rows="2"
								maxlength="1000"
								bind:value={reason}
								name="reason"
								required
							></textarea>
						</label>
						<div class="flex gap-2 sm:col-span-2">
							<button type="submit" class="btn btn-sm btn-primary" disabled={busy}>
								{#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
								{m.admin_money_record_submit()}
							</button>
							<button
								type="button"
								class="btn btn-ghost btn-sm"
								disabled={busy}
								onclick={() => (recording = null)}
							>
								{m.common_cancel()}
							</button>
						</div>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if deciding}
	<ConfirmDialog
		open={deciding !== null}
		title={deciding.decision === 'approved'
			? m.admin_money_approve_title()
			: m.admin_money_reject_title()}
		body={deciding.decision === 'approved'
			? m.admin_money_approve_body({ amount: formatMoney(deciding.payout.amountCents) })
			: m.admin_money_reject_body()}
		confirmLabel={deciding.decision === 'approved'
			? m.admin_money_approve()
			: m.admin_money_reject()}
		cancelLabel={m.common_back()}
		confirmClass={deciding.decision === 'approved' ? 'btn-primary' : 'btn-error'}
		{busy}
		onconfirm={() => void submitDecision()}
		oncancel={() => (deciding = null)}
	>
		<label class="flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold text-base-content">
				{deciding.decision === 'rejected'
					? m.admin_money_field_note_required()
					: m.admin_money_field_note()}
			</span>
			<textarea
				class="textarea textarea-sm w-full"
				rows="2"
				maxlength="1000"
				bind:value={decisionNote}
				data-testid="manual-payout-note"
			></textarea>
		</label>
	</ConfirmDialog>
{/if}
