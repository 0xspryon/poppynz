<script lang="ts">
	/** One reimbursement or obligation with its full trail (Tier 3 step 5):
	 * what it points at (session, cycle, payment, Stripe object), the row's
	 * audit, the session's events, ledger entries and transfers, and the
	 * accountant's notes. Notes and the reconciled mark are made here (by
	 * permission); money never moves from this drawer. */
	import {
		accountantErrorText,
		addReimbursementNote,
		causeLabel,
		directionLabel,
		eventActionLabel,
		getReimbursement,
		reconcileReimbursement,
		reimbursementStatusLabel,
		reimbursementStatusTone,
		reimbursementTypeLabel,
		type ReimbursementDetail
	} from '$lib/api/accountant';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		itemKey: string;
		canNote: boolean;
		canReconcile: boolean;
		onclose: () => void;
		/** After a note or a mark, so the list can refresh. */
		onchange: () => void;
	}

	let { itemKey, canNote, canReconcile, onclose, onchange }: Props = $props();

	let detail = $state.raw<ReimbursementDetail | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let note = $state('');
	let reconcileNote = $state('');

	let seq = 0;
	async function load(key: string) {
		seq += 1;
		const mine = seq;
		loading = true;
		const result = await getReimbursement(key);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) detail = result.data;
		else {
			toast.error(accountantErrorText(result.error));
			onclose();
		}
	}

	$effect(() => {
		void load(itemKey);
	});

	async function saveNote(event: SubmitEvent) {
		event.preventDefault();
		if (busy || note.trim() === '') return;
		busy = true;
		const result = await addReimbursementNote(itemKey, note.trim());
		busy = false;
		if (result.ok) {
			note = '';
			toast.success(m.books_note_saved());
			onchange();
			await load(itemKey);
		} else toast.error(accountantErrorText(result.error));
	}

	async function setReconciled(reconciled: boolean) {
		if (busy) return;
		busy = true;
		const result = await reconcileReimbursement(itemKey, reconciled, reconcileNote.trim());
		busy = false;
		if (result.ok) {
			reconcileNote = '';
			toast.success(reconciled ? m.books_reconciled_toast() : m.books_unreconciled_toast());
			onchange();
			await load(itemKey);
		} else toast.error(accountantErrorText(result.error));
	}

	const item = $derived(detail?.item ?? null);
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="fixed inset-0 z-40 flex justify-end bg-black/30" role="presentation" onclick={onclose}>
	<div
		class="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-base-100 shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-label={m.books_detail_title()}
		tabindex="-1"
		onclick={(event) => event.stopPropagation()}
		onkeydown={(event) => event.stopPropagation()}
		data-testid="reimbursement-drawer"
	>
		<header class="flex items-start justify-between gap-3 border-b border-card-border px-5 py-4">
			<div class="min-w-0">
				<p class="text-xs text-base-content-muted">{m.books_detail_title()}</p>
				{#if item}
					<h2 class="font-display text-lg font-bold text-base-content">
						{reimbursementTypeLabel(item.type)} · {formatMoney(item.amountCents)}
					</h2>
					<div class="mt-1 flex flex-wrap items-center gap-2">
						<StatusChip
							status={reimbursementStatusTone(item.status)}
							label={reimbursementStatusLabel(item.status)}
						/>
						<span class="text-xs text-base-content-muted">{directionLabel(item.direction)}</span>
					</div>
				{/if}
			</div>
			<button type="button" class="btn btn-ghost btn-sm" onclick={onclose}>
				<i class="las la-times" aria-hidden="true"></i>
				<span class="sr-only">{m.books_detail_close()}</span>
			</button>
		</header>

		{#if loading && !detail}
			<div class="flex justify-center py-16">
				<span class="loading loading-lg loading-spinner text-primary"></span>
			</div>
		{:else if detail && item}
			<div class="flex flex-col gap-6 px-5 py-4 text-sm">
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
					<dt class="text-base-content-muted">{m.books_detail_amount()}</dt>
					<dd class="tabular-nums">{formatMoney(item.amountCents)}</dd>
					<dt class="text-base-content-muted">{m.books_detail_outstanding()}</dt>
					<dd class="tabular-nums">{formatMoney(item.outstandingCents)}</dd>
					<dt class="text-base-content-muted">{m.books_detail_occurred()}</dt>
					<dd>{formatDateTime(item.occurredAt)}</dd>
					{#if item.settledAt}
						<dt class="text-base-content-muted">{m.books_detail_settled()}</dt>
						<dd>{formatDateTime(item.settledAt)}</dd>
					{/if}
					{#if item.familyName}
						<dt class="text-base-content-muted">{m.books_detail_family()}</dt>
						<dd>{item.familyName}</dd>
					{/if}
					{#if item.helperName}
						<dt class="text-base-content-muted">{m.books_detail_helper()}</dt>
						<dd>{item.helperName}</dd>
					{/if}
					{#if item.contractId}
						<dt class="text-base-content-muted">{m.books_detail_contract()}</dt>
						<dd class="font-mono text-xs break-all">{item.contractId}</dd>
					{/if}
					{#if item.cycleLabel}
						<dt class="text-base-content-muted">{m.books_detail_cycle()}</dt>
						<dd>{item.cycleLabel}</dd>
					{/if}
					{#if item.sessionDate}
						<dt class="text-base-content-muted">{m.books_detail_session()}</dt>
						<dd>
							{formatDateWithWeekday(item.sessionDate)}{#if item.serviceName}
								· {item.serviceName}{/if}
						</dd>
					{/if}
					{#if item.paymentReference || item.paymentId}
						<dt class="text-base-content-muted">{m.books_detail_payment()}</dt>
						<dd class="font-mono text-xs break-all">{item.paymentReference ?? item.paymentId}</dd>
					{/if}
					{#if item.providerObject}
						<dt class="text-base-content-muted">{m.books_detail_stripe()}</dt>
						<dd class="font-mono text-xs break-all">{item.providerObject.reference}</dd>
					{/if}
					{#if item.cause}
						<dt class="text-base-content-muted">{m.books_detail_cause()}</dt>
						<dd>{causeLabel(item.cause)}</dd>
					{/if}
					{#if item.detail}
						<dt class="text-base-content-muted">{m.books_detail_detail()}</dt>
						<dd class="break-words">{item.detail}</dd>
					{/if}
				</dl>

				{#if item.reconciled}
					<p class="rounded-lg bg-success/10 px-3 py-2 text-success">
						{m.books_detail_reconciled_by({
							by: item.reconciled.by ?? '—',
							when: formatDateTime(item.reconciled.at)
						})}{#if item.reconciled.note}: {item.reconciled.note}{/if}
					</p>
				{/if}

				{#if canReconcile}
					<section class="flex flex-col gap-2">
						{#if item.canReconcile}
							{#if !item.reconciled}
								<label class="flex flex-col gap-1">
									<span class="text-xs font-semibold">{m.books_detail_reconcile_note()}</span>
									<input
										class="input input-sm w-full"
										maxlength="2000"
										bind:value={reconcileNote}
										data-testid="reconcile-note"
									/>
								</label>
							{/if}
							<button
								type="button"
								class={['btn btn-sm', item.reconciled ? 'btn-outline' : 'btn-primary']}
								disabled={busy}
								onclick={() => void setReconciled(!item.reconciled)}
								data-testid="reconcile-toggle"
							>
								{item.reconciled ? m.books_detail_unreconcile() : m.books_detail_reconcile()}
							</button>
						{:else}
							<p class="text-xs text-base-content-muted">{m.books_detail_not_settled()}</p>
						{/if}
					</section>
				{/if}

				<section>
					<h3 class="mb-2 font-semibold">{m.books_detail_notes()}</h3>
					{#if detail.notes.length === 0}
						<p class="text-xs text-base-content-muted">{m.books_detail_no_notes()}</p>
					{:else}
						<ul class="flex flex-col gap-2">
							{#each detail.notes as row (row.id)}
								<li class="rounded-lg border border-card-border px-3 py-2">
									<p class="break-words">{row.note}</p>
									<p class="text-[11px] text-base-content-muted">
										{row.by ?? '—'} · {formatDateTime(row.at)}
									</p>
								</li>
							{/each}
						</ul>
					{/if}
					{#if canNote}
						<form class="mt-2 flex flex-col gap-2" onsubmit={saveNote}>
							<label class="flex flex-col gap-1">
								<span class="text-xs font-semibold">{m.books_detail_note_label()}</span>
								<textarea
									class="textarea textarea-sm w-full"
									rows="2"
									maxlength="2000"
									bind:value={note}
									data-testid="reimbursement-note"
								></textarea>
							</label>
							<button
								type="submit"
								class="btn self-start btn-outline btn-sm"
								disabled={busy || note.trim() === ''}
							>
								{m.books_detail_save_note()}
							</button>
						</form>
					{/if}
				</section>

				<section>
					<h3 class="mb-2 font-semibold">{m.books_detail_trail()}</h3>
					{#if detail.trail.events.length === 0}
						<p class="text-xs text-base-content-muted">{m.books_detail_trail_empty()}</p>
					{:else}
						<ol class="flex flex-col gap-1">
							{#each detail.trail.events as row (row.id)}
								<li class="text-xs">
									<span class="text-base-content-muted">{formatDateTime(row.at)}</span>
									· {row.by
										? m.books_event_by({ action: eventActionLabel(row.action), by: row.by })
										: eventActionLabel(row.action)}{#if row.note}: {row.note}{/if}
								</li>
							{/each}
						</ol>
					{/if}
				</section>

				{#if detail.trail.resolutions.length > 0}
					<section>
						<h3 class="mb-2 font-semibold">{m.books_detail_resolutions()}</h3>
						<ul class="flex flex-col gap-1 text-xs">
							{#each detail.trail.resolutions as row (row.id)}
								<li>
									<span class="text-base-content-muted">{formatDateTime(row.recordedAt)}</span>
									· {row.kind} · {row.status}{#if row.decision}
										→ {row.decision}{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if detail.trail.ledger.length > 0}
					<section>
						<h3 class="mb-2 font-semibold">{m.books_detail_ledger()}</h3>
						<div class="overflow-x-auto">
							<table class="table table-xs">
								<tbody>
									{#each detail.trail.ledger as row (row.id)}
										<tr>
											<td class="whitespace-nowrap">{formatDateTime(row.at)}</td>
											<td>{row.kind}</td>
											<td>{row.party}</td>
											<td class="text-right tabular-nums">{formatMoney(row.amountCents)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{/if}

				{#if detail.trail.transferItems.length > 0}
					<section>
						<h3 class="mb-2 font-semibold">{m.books_detail_transfers()}</h3>
						<ul class="flex flex-col gap-1 text-xs">
							{#each detail.trail.transferItems as row (row.id)}
								<li>
									{row.kind} · {formatMoney(row.amountCents)} · {row.transferStatus ?? '—'}
									{#if row.transferReference}
										· <span class="font-mono">{row.transferReference}</span>{/if}
									{#if row.payoutReference}
										<br />
										{row.payoutMatch === 'exact'
											? m.books_payout_exact({ payout: row.payoutReference })
											: m.books_payout_approximate({ payout: row.payoutReference })}
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>
