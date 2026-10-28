<script lang="ts">
	/** One card dispute (Tier 3 step 4): what Poppynz bears, the sessions on
	 * the disputed charge, the evidence pack assembled from the records, the
	 * summary for the bank (draft, then one submission through Stripe), the
	 * per-session decision once lost, and suspending or resuming the
	 * family's contracts — every action audited by the API. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		allocateCardDispute,
		getCardDispute,
		resumeFamilyContracts,
		saveCardDisputeSummary,
		submitCardDisputeEvidence,
		suspendFamilyContracts,
		type CardDisputeAllocation,
		type CardDisputeDetail,
		type SuspensionReason
	} from '$lib/api/card-disputes';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import {
		cardDisputeErrorMessage,
		cardDisputeReasonLabel,
		cardDisputeScopeLabel,
		cardDisputeStatusChip,
		cardDisputeStatusLabel,
		cardDisputeTriageLabel,
		suspensionReasonLabel
	} from '$lib/card-disputes';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { dollarsToCents, formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import {
		resolutionKindLabel,
		resolutionStatusChip,
		type ResolutionKind,
		type ResolutionStatus
	} from '$lib/session-resolution';
	import { refundStatusChip, type RefundStatus } from '$lib/session-money';
	import { toast } from '$lib/toast.svelte';

	const id = $derived(page.params.id ?? '');

	let dispute = $state<CardDisputeDetail | null>(null);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	let busy = $state(false);

	let summary = $state('');
	let confirmSubmit = $state(false);
	let openAgreement = $state<number | null>(null);

	type Choice = { allocation: CardDisputeAllocation | ''; reason: string; forfeit: string };
	let choices = $state<Record<string, Choice>>({});

	let suspending = $state(false);
	let suspendReason = $state<SuspensionReason | ''>('');
	let suspendNote = $state('');
	let resuming = $state(false);
	let resumeNote = $state('');

	let seq = 0;
	async function load(forId: string) {
		seq += 1;
		const mine = seq;
		const result = await getCardDispute(forId);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			dispute = result.data.dispute;
			summary = dispute.evidenceSummary ?? dispute.suggestedSummary;
			choices = Object.fromEntries(
				dispute.pack.sessions
					.filter((row) => row.allocation === null)
					.map((row) => [row.sessionId, { allocation: '', reason: '', forfeit: '' }])
			);
			errorMessage = null;
		} else {
			errorMessage = cardDisputeErrorMessage(result.error);
		}
	}

	$effect(() => {
		if (id) void load(id);
	});

	const canSubmit = $derived(dispute !== null && dispute.triage === 'needs_response');
	const time = (minutes: number | null) =>
		minutes === null
			? ''
			: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	const sideLabel = (side: string) =>
		side === 'family'
			? m.admin_card_disputes_side_family()
			: side === 'helper'
				? m.admin_card_disputes_side_helper()
				: m.admin_card_disputes_side_other();
	const at = (value: string | null) => (value ? formatDateTime(value) : '—');

	async function saveDraft() {
		if (!dispute || busy) return;
		if (summary.trim() === '') {
			toast.error(m.admin_card_disputes_summary_missing());
			return;
		}
		busy = true;
		const result = await saveCardDisputeSummary(dispute.id, summary.trim());
		busy = false;
		if (result.ok) toast.success(m.admin_card_disputes_draft_saved());
		else toast.error(cardDisputeErrorMessage(result.error));
	}

	function askSubmit() {
		if (summary.trim() === '') {
			toast.error(m.admin_card_disputes_summary_missing());
			return;
		}
		confirmSubmit = true;
	}

	async function submit() {
		if (!dispute || busy) return;
		busy = true;
		const result = await submitCardDisputeEvidence(dispute.id, summary.trim());
		busy = false;
		confirmSubmit = false;
		if (result.ok) toast.success(m.admin_card_disputes_submitted_toast());
		else toast.error(cardDisputeErrorMessage(result.error));
		await load(dispute.id);
	}

	async function allocate() {
		if (!dispute || busy) return;
		const entries = Object.entries(choices);
		const incomplete = entries.some(
			([, choice]) =>
				choice.allocation === '' ||
				(choice.allocation === 'helper_not_provided' && choice.reason.trim() === '')
		);
		if (entries.length === 0 || incomplete) {
			toast.error(m.admin_card_disputes_allocate_missing());
			return;
		}
		const items = entries.map(([sessionId, choice]) => ({
			sessionId,
			allocation: choice.allocation as CardDisputeAllocation,
			reason: choice.reason.trim() || null,
			helperForfeitCents:
				choice.allocation === 'helper_not_provided' && choice.forfeit.trim() !== ''
					? dollarsToCents(choice.forfeit)
					: null
		}));
		busy = true;
		const result = await allocateCardDispute(dispute.id, items);
		busy = false;
		if (result.ok) toast.success(m.admin_card_disputes_allocated_toast());
		else toast.error(cardDisputeErrorMessage(result.error));
		await load(dispute.id);
	}

	async function suspend() {
		if (!dispute || busy) return;
		if (suspendReason === '' || suspendNote.trim() === '') {
			toast.error(m.admin_card_disputes_suspend_missing());
			return;
		}
		busy = true;
		const result = await suspendFamilyContracts(dispute.familyUserId, {
			reason: suspendReason,
			note: suspendNote.trim(),
			disputeId: dispute.id
		});
		busy = false;
		suspending = false;
		if (result.ok) toast.success(m.admin_card_disputes_suspended_toast());
		else toast.error(cardDisputeErrorMessage(result.error));
		await load(dispute.id);
	}

	async function resume() {
		if (!dispute || busy) return;
		if (resumeNote.trim() === '') {
			toast.error(m.admin_card_disputes_resume_missing());
			return;
		}
		busy = true;
		const result = await resumeFamilyContracts(dispute.familyUserId, resumeNote.trim());
		busy = false;
		resuming = false;
		if (result.ok) toast.success(m.admin_card_disputes_resumed_toast());
		else toast.error(cardDisputeErrorMessage(result.error));
		await load(dispute.id);
	}
</script>

<svelte:head>
	<title>{m.admin_card_disputes_detail_page_title()}</title>
</svelte:head>

<a
	class="mb-4 inline-flex items-center gap-1 text-sm text-primary"
	href={resolve('/admin/card-disputes')}
>
	<i class="las la-arrow-left" aria-hidden="true"></i>
	{m.admin_card_disputes_back()}
</a>

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if errorMessage || !dispute}
	<p class="text-sm text-base-content-muted" data-testid="card-dispute-error">{errorMessage}</p>
{:else}
	{@const pack = dispute.pack}
	<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl font-bold text-base-content lg:text-3xl">
				{m.admin_card_disputes_detail_heading({ amount: formatMoney(dispute.amountCents) })}
			</h1>
			<p class="text-sm text-base-content-muted">
				{m.admin_card_disputes_opened({
					when: formatDateTime(dispute.openedAt),
					family: dispute.familyName,
					reference: dispute.providerReference
				})}
			</p>
			<p class="text-sm text-base-content-muted">
				{cardDisputeReasonLabel(dispute.reason)} · {cardDisputeScopeLabel(dispute.scope)} · {cardDisputeTriageLabel(
					dispute.triage
				)}
			</p>
		</div>
		<StatusChip
			status={cardDisputeStatusChip(dispute.status)}
			label={cardDisputeStatusLabel(dispute.status)}
		/>
	</div>

	{#if dispute.closedAt === null}
		<div role="status" class="alert mb-3 alert-warning text-sm" data-testid="family-flagged">
			{m.admin_card_disputes_family_flagged()}
		</div>
	{/if}
	{#if dispute.family.suspended}
		<div role="status" class="alert mb-3 alert-error text-sm" data-testid="family-suspended">
			{m.admin_card_disputes_family_suspended()}
		</div>
	{/if}

	{#if dispute.money}
		<section
			class="mb-5 rounded-xl border border-card-border bg-base-100 p-4"
			data-testid="card-dispute-money"
		>
			<h2 class="mb-2 font-semibold text-base-content">{m.admin_card_disputes_money_heading()}</h2>
			<dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
				<dt class="text-base-content-muted">{m.admin_card_disputes_money_withdrawn()}</dt>
				<dd>{formatMoney(dispute.money.withdrawnCents)}</dd>
				<dt class="text-base-content-muted">{m.admin_card_disputes_money_reinstated()}</dt>
				<dd>{formatMoney(dispute.money.reinstatedCents)}</dd>
				<dt class="text-base-content-muted">{m.admin_card_disputes_money_fee()}</dt>
				<dd>{formatMoney(dispute.money.feeCents)}</dd>
				<dt class="font-semibold">{m.admin_card_disputes_money_net()}</dt>
				<dd class="font-semibold">{formatMoney(dispute.money.netCents)}</dd>
			</dl>
		</section>
	{/if}

	<section class="mb-5 rounded-xl border border-card-border bg-base-100 p-4">
		<h2 class="mb-2 font-semibold text-base-content">{m.admin_card_disputes_sessions_heading()}</h2>
		{#if pack.sessions.length === 0}
			<p class="text-sm text-base-content-muted">{m.admin_card_disputes_sessions_empty()}</p>
		{:else}
			<ul class="flex flex-col gap-3" data-testid="card-dispute-sessions">
				{#each pack.sessions as row (row.sessionId)}
					<li class="border-b border-card-border pb-3 last:border-0">
						<p class="font-semibold">
							{row.date ? formatDateWithWeekday(row.date) : '—'}
							{time(row.startMinutes)}–{time(row.endMinutes)} · {row.serviceName ?? ''}
						</p>
						<p class="text-[12.5px] text-base-content-muted">
							{m.admin_card_disputes_session_amounts({
								paid: formatMoney(row.familyTotalCents),
								disputed: formatMoney(row.disputedCents)
							})}
						</p>
						<p class="text-[12.5px]">
							{row.resolution
								? m.admin_card_disputes_session_report({
										kind: resolutionKindLabel(row.resolution.kind as ResolutionKind),
										status: resolutionStatusChip(row.resolution.status as ResolutionStatus).label
									})
								: m.admin_card_disputes_session_no_report()}
						</p>
						{#if row.extraAuthorisation?.authorisedAt}
							<p class="text-[12.5px]">
								{m.admin_card_disputes_session_extra({
									when: formatDateTime(row.extraAuthorisation.authorisedAt),
									amount: formatMoney(row.extraAuthorisation.authorisedCents ?? 0)
								})}
							</p>
						{/if}
						{#if row.allocation === 'poppynz_absorbs'}
							<p class="text-[12.5px] font-semibold">
								{m.admin_card_disputes_allocation_absorbed()}
							</p>
						{:else if row.allocation === 'helper_not_provided'}
							<p class="text-[12.5px] font-semibold">
								{row.recovered
									? m.admin_card_disputes_allocation_helper_recovered({
											amount: formatMoney(row.helperForfeitCents)
										})
									: m.admin_card_disputes_allocation_helper_withheld({
											amount: formatMoney(row.helperForfeitCents)
										})}
								{#if row.allocationReason}— {row.allocationReason}{/if}
							</p>
						{:else if dispute.triage === 'allocation_needed' && choices[row.sessionId]}
							<div class="mt-2 flex flex-col gap-2" data-testid="allocation-form">
								<label class="flex items-center gap-2 text-[12.5px]">
									<input
										type="radio"
										class="radio radio-sm"
										value="poppynz_absorbs"
										bind:group={choices[row.sessionId]!.allocation}
									/>
									{m.admin_card_disputes_allocate_absorb()}
								</label>
								<label class="flex items-center gap-2 text-[12.5px]">
									<input
										type="radio"
										class="radio radio-sm"
										value="helper_not_provided"
										bind:group={choices[row.sessionId]!.allocation}
									/>
									{m.admin_card_disputes_allocate_helper()}
								</label>
								{#if choices[row.sessionId]!.allocation === 'helper_not_provided'}
									<label class="flex flex-col gap-1 text-[12.5px]">
										<span>{m.admin_card_disputes_allocate_reason()}</span>
										<textarea
											class="textarea textarea-sm w-full"
											rows="2"
											maxlength="2000"
											bind:value={choices[row.sessionId]!.reason}
										></textarea>
									</label>
									<label class="flex flex-col gap-1 text-[12.5px]">
										<span>
											{m.admin_card_disputes_allocate_forfeit({
												amount: formatMoney(row.defaultHelperForfeitCents)
											})}
										</span>
										<input
											class="input input-sm w-40"
											inputmode="decimal"
											bind:value={choices[row.sessionId]!.forfeit}
										/>
									</label>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if dispute.triage === 'allocation_needed'}
				<div class="mt-3">
					<h3 class="font-semibold">{m.admin_card_disputes_allocate_heading()}</h3>
					<p class="mb-2 text-[12.5px] text-base-content-muted">
						{m.admin_card_disputes_allocate_intro()}
					</p>
					<button
						type="button"
						class="btn btn-sm btn-primary"
						disabled={busy}
						onclick={() => void allocate()}
						data-testid="allocate-submit"
					>
						{m.admin_card_disputes_allocate_submit()}
					</button>
				</div>
			{/if}
		{/if}
	</section>

	<section class="mb-5 rounded-xl border border-card-border bg-base-100 p-4">
		<h2 class="mb-1 font-semibold text-base-content">{m.admin_card_disputes_evidence_heading()}</h2>
		{#if canSubmit}
			<p class="mb-2 text-[12.5px] text-base-content-muted">
				{m.admin_card_disputes_evidence_intro()}
			</p>
			<label class="flex flex-col gap-1 text-[12.5px]">
				<span class="font-semibold">{m.admin_card_disputes_summary_label()}</span>
				<textarea
					class="textarea w-full font-mono text-[12.5px]"
					rows="10"
					maxlength="20000"
					bind:value={summary}
					data-testid="evidence-summary"
				></textarea>
			</label>
			<p class="mt-1 text-[11.5px] text-outline">{m.admin_card_disputes_test_hint()}</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => (summary = dispute!.suggestedSummary)}
				>
					{m.admin_card_disputes_use_suggested()}
				</button>
				<button
					type="button"
					class="btn btn-outline btn-sm"
					disabled={busy}
					onclick={() => void saveDraft()}
					data-testid="evidence-save"
				>
					{m.admin_card_disputes_save_draft()}
				</button>
				<button
					type="button"
					class="btn btn-sm btn-primary"
					disabled={busy}
					onclick={askSubmit}
					data-testid="evidence-submit"
				>
					{m.admin_card_disputes_submit()}
				</button>
			</div>
		{:else if pack.submissions.length === 0}
			<p class="text-[12.5px] text-base-content-muted">{m.admin_card_disputes_evidence_closed()}</p>
		{/if}
		{#each pack.submissions as submission (submission.id)}
			<p class="mt-2 text-[12.5px]" data-testid="evidence-submission">
				{m.admin_card_disputes_submitted_at({
					when: formatDateTime(submission.submittedAt),
					who: dispute.names[submission.submittedByUserId] ?? '—',
					status: cardDisputeStatusLabel(submission.providerStatus)
				})}
			</p>
			<pre
				class="mt-1 whitespace-pre-wrap rounded bg-base-200 p-2 text-[12px]">{submission.summary}</pre>
		{/each}
		<details class="mt-3">
			<summary class="cursor-pointer text-[12.5px] font-semibold"
				>{m.admin_card_disputes_fields_heading()}</summary
			>
			<dl class="mt-2 flex flex-col gap-2 text-[12px]">
				{#each Object.entries(dispute.evidenceFields).filter(([field]) => field !== 'uncategorized_text') as [field, value] (field)}
					<div>
						<dt class="font-mono text-outline">{field}</dt>
						<dd class="whitespace-pre-wrap">{value}</dd>
					</div>
				{/each}
			</dl>
			<p class="mt-2 text-[12px]">
				{m.admin_card_disputes_documents({
					list: [
						m.admin_card_disputes_document_service(),
						...(dispute.evidenceDocuments.customerCommunication
							? [m.admin_card_disputes_document_messages()]
							: [])
					].join(', ')
				})}
			</p>
		</details>
	</section>

	<section class="mb-5 rounded-xl border border-card-border bg-base-100 p-4">
		<h2 class="mb-2 font-semibold text-base-content">
			{m.admin_card_disputes_agreement_heading()}
		</h2>
		{#if pack.agreement.length === 0}
			<p class="text-[12.5px] text-base-content-muted">{m.admin_card_disputes_agreement_none()}</p>
		{/if}
		{#each pack.agreement as signature, index (index)}
			<div class="mb-2">
				<p class="text-[12.5px] break-all">
					{m.admin_card_disputes_agreement_meta({
						side: sideLabel(signature.side),
						when: formatDateTime(signature.signedAt),
						template: String(signature.templateVersion),
						policy: String(signature.cancellationPolicyVersion ?? '—'),
						hash: signature.sha256
					})}
				</p>
				<button
					type="button"
					class="btn btn-ghost btn-xs"
					onclick={() => (openAgreement = openAgreement === index ? null : index)}
				>
					{openAgreement === index
						? m.admin_card_disputes_hide_text()
						: m.admin_card_disputes_show_text()}
				</button>
				{#if openAgreement === index}
					<pre
						class="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-2 text-[12px]">{signature.content}</pre>
				{/if}
			</div>
		{/each}

		<h2 class="mt-4 mb-2 font-semibold text-base-content">
			{m.admin_card_disputes_charge_heading()}
		</h2>
		{#if pack.payment}
			<p class="text-[12.5px]">
				{m.admin_card_disputes_charge_line({
					reference: pack.payment.providerReference ?? pack.payment.id,
					authorised: at(pack.payment.authorisedAt),
					captured: at(pack.payment.capturedAt),
					amount: formatMoney(pack.payment.capturedCents ?? pack.payment.totalCents)
				})}
			</p>
		{/if}

		<h2 class="mt-4 mb-2 font-semibold text-base-content">
			{m.admin_card_disputes_refunds_heading()}
		</h2>
		{#if pack.refunds.length === 0}
			<p class="text-[12.5px] text-base-content-muted">{m.admin_card_disputes_refunds_empty()}</p>
		{:else}
			<ul class="text-[12.5px]">
				{#each pack.refunds as refund (refund.id)}
					<li>
						{m.admin_card_disputes_refund_line({
							amount: formatMoney(refund.totalCents),
							status:
								refund.status === 'pending' && dispute.closedAt === null
									? m.admin_card_disputes_refund_waiting()
									: refundStatusChip(refund.status as RefundStatus).label
						})}
					</li>
				{/each}
			</ul>
		{/if}

		<h2 class="mt-4 mb-2 font-semibold text-base-content">
			{m.admin_card_disputes_messages_heading()}
		</h2>
		{#if pack.messages.length === 0}
			<p class="text-[12.5px] text-base-content-muted">{m.admin_card_disputes_messages_empty()}</p>
		{:else}
			<ul class="flex flex-col gap-1 text-[12.5px]" data-testid="card-dispute-messages">
				{#each pack.messages as message, index (index)}
					<li>
						<span class="text-outline"
							>{m.admin_card_disputes_message_meta({
								when: formatDateTime(message.sentAt),
								side: sideLabel(message.side)
							})}</span
						>
						{message.body}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mb-5 rounded-xl border border-card-border bg-base-100 p-4">
		<h2 class="mb-1 font-semibold text-base-content">{m.admin_card_disputes_suspend_heading()}</h2>
		<p class="mb-2 text-[12.5px] text-base-content-muted">
			{m.admin_card_disputes_suspend_intro()}
		</p>
		<div class="flex flex-wrap gap-2">
			{#if dispute.family.suspendable.length > 0}
				<button
					type="button"
					class="btn btn-outline btn-sm btn-error"
					onclick={() => {
						suspending = true;
						suspendReason = '';
						suspendNote = '';
					}}
					data-testid="family-suspend"
				>
					{m.admin_card_disputes_suspend_button()}
				</button>
			{/if}
			{#if dispute.family.suspended}
				<button
					type="button"
					class="btn btn-sm btn-primary"
					onclick={() => {
						resuming = true;
						resumeNote = '';
					}}
					data-testid="family-resume"
				>
					{m.admin_card_disputes_resume_button()}
				</button>
			{/if}
		</div>
		{#if dispute.family.history.length > 0}
			<ul class="mt-2 text-[12px] text-base-content-muted" data-testid="family-history">
				{#each dispute.family.history as event, index (index)}
					<li>
						{event.action === 'contracts_suspended'
							? m.admin_card_disputes_history_suspended({
									when: formatDateTime(event.at),
									who: event.actorName ?? '—',
									reason: suspensionReasonLabel(event.reason),
									note: event.note ?? ''
								})
							: m.admin_card_disputes_history_resumed({
									when: formatDateTime(event.at),
									who: event.actorName ?? '—',
									note: event.note ?? ''
								})}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<ConfirmDialog
		open={confirmSubmit}
		title={m.admin_card_disputes_submit_title()}
		body={m.admin_card_disputes_submit_body()}
		confirmLabel={m.admin_card_disputes_submit()}
		cancelLabel={m.common_back()}
		confirmClass="btn-primary"
		{busy}
		onconfirm={() => void submit()}
		oncancel={() => (confirmSubmit = false)}
	/>

	<ConfirmDialog
		open={suspending}
		title={m.admin_card_disputes_suspend_title()}
		body={m.admin_card_disputes_suspend_body()}
		confirmLabel={m.admin_card_disputes_suspend_confirm()}
		cancelLabel={m.common_back()}
		{busy}
		onconfirm={() => void suspend()}
		oncancel={() => (suspending = false)}
	>
		<label class="flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold">{m.admin_card_disputes_suspend_reason()}</span>
			<select class="select select-sm" bind:value={suspendReason} data-testid="suspend-reason">
				<option value="" disabled></option>
				<option value="unreliable_payment_method">
					{m.admin_card_disputes_suspend_reason_unreliable_payment_method()}
				</option>
				<option value="suspected_fraud"
					>{m.admin_card_disputes_suspend_reason_suspected_fraud()}</option
				>
			</select>
		</label>
		<label class="mt-2 flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold">{m.admin_card_disputes_suspend_note()}</span>
			<textarea
				class="textarea textarea-sm w-full"
				rows="3"
				maxlength="2000"
				bind:value={suspendNote}
				data-testid="suspend-note"
			></textarea>
		</label>
	</ConfirmDialog>

	<ConfirmDialog
		open={resuming}
		title={m.admin_card_disputes_resume_title()}
		body={m.admin_card_disputes_resume_body()}
		confirmLabel={m.admin_card_disputes_resume_confirm()}
		cancelLabel={m.common_back()}
		confirmClass="btn-primary"
		{busy}
		onconfirm={() => void resume()}
		oncancel={() => (resuming = false)}
	>
		<label class="flex flex-col gap-1 text-[12.5px]">
			<span class="font-semibold">{m.admin_card_disputes_resume_note()}</span>
			<textarea
				class="textarea textarea-sm w-full"
				rows="3"
				maxlength="2000"
				bind:value={resumeNote}
				data-testid="resume-note"
			></textarea>
		</label>
	</ConfirmDialog>
{/if}
