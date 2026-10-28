<script lang="ts">
	/** One contested session (Tier 3): both statements, the session in the
	 * contract zone, the messages from 24 h before to 24 h after it, the
	 * signed agreement and the policy version, the history — and the
	 * decision (an outcome and a required reason; audited by the API). */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		decideSessionDispute,
		getSessionDispute,
		type SessionDisputeDecision,
		type SessionDisputeDetail
	} from '$lib/api/session-disputes';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatNumber } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';
	import { resolutionKindLabel, sessionReasonLabel } from '$lib/session-resolution';
	import { toast } from '$lib/toast.svelte';

	const id = $derived(page.params.id ?? '');

	let dispute = $state<SessionDisputeDetail | null>(null);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	let decision = $state<SessionDisputeDecision | ''>('');
	let reason = $state('');
	let minutesWorked = $state('');
	let deciding = $state(false);
	let openAgreement = $state<string | null>(null);

	const outcomes: ReadonlyArray<SessionDisputeDecision> = [
		'as_scheduled',
		'family_cancelled_early',
		'family_cancelled_late',
		'family_no_show',
		'family_reduced_hours',
		'helper_cancelled',
		'helper_no_show',
		'day_off_agreed'
	];

	let seq = 0;
	async function load(forId: string) {
		seq += 1;
		const mine = seq;
		const result = await getSessionDispute(forId);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			dispute = result.data.dispute;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'SESSION_DISPUTE_NOT_FOUND'
					? m.admin_disputes_error_not_found()
					: result.error.code === 'FORBIDDEN'
						? m.admin_disputes_error_forbidden()
						: m.admin_disputes_error_load();
		}
	}

	$effect(() => {
		if (id) void load(id);
	});

	const hours = (minutes: number) => formatNumber(minutes / 60, { maximumFractionDigits: 2 });

	async function decide() {
		if (!dispute || deciding) return;
		if (decision === '' || reason.trim() === '') {
			toast.error(m.admin_disputes_decide_missing());
			return;
		}
		deciding = true;
		const result = await decideSessionDispute(dispute.id, {
			decision,
			reason: reason.trim(),
			minutesWorked: decision === 'family_reduced_hours' ? Number(minutesWorked) : null
		});
		deciding = false;
		if (result.ok) {
			toast.success(m.admin_disputes_decided_toast());
			await load(dispute.id);
			return;
		}
		switch (result.error.code) {
			case 'SESSION_DISPUTE_NOT_OPEN':
				toast.error(m.admin_disputes_error_not_open());
				await load(dispute.id);
				return;
			case 'SESSION_DISPUTE_MINUTES_REQUIRED':
				toast.error(m.admin_disputes_error_minutes());
				return;
			case 'INVALID_SESSION_DECISION':
				toast.error(m.admin_disputes_decide_missing());
				return;
			case 'FORBIDDEN':
				toast.error(m.admin_disputes_error_forbidden());
				return;
			default:
				toast.error(m.admin_disputes_error_decide());
		}
	}

	const actionLabel = (action: string) => {
		switch (action) {
			case 'recorded':
				return m.admin_disputes_history_recorded();
			case 'accepted':
				return m.admin_disputes_history_accepted();
			case 'contested':
			case 'disputed':
				return m.admin_disputes_history_contested();
			case 'declined':
				return m.admin_disputes_history_declined();
			case 'confirmed_by_silence':
				return m.admin_disputes_history_silence();
			case 'lapsed':
				return m.admin_disputes_history_lapsed();
			case 'decided':
				return m.admin_disputes_history_decided();
			default:
				return action;
		}
	};
</script>

<svelte:head>
	<title>{m.admin_disputes_detail_page_title()}</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-4">
	<a
		href={resolve('/admin/session-disputes')}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		{m.admin_disputes_back()}
	</a>

	{#if loading}
		<div class="flex justify-center py-16">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if errorMessage || !dispute}
		<p
			class="flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content px-4 py-3 text-sm font-medium text-error"
			role="alert"
		>
			{errorMessage}
		</p>
	{:else}
		<header>
			<h1 class="font-display text-xl font-bold text-base-content lg:text-2xl">
				{resolutionKindLabel(dispute.kind)} · {dispute.session.serviceName}
			</h1>
			<p class="text-sm text-base-content-muted">
				{formatDateWithWeekday(dispute.session.date)} · {formatSessionRange({
					weekday: 0,
					startMinutes: dispute.session.startMinutes,
					endMinutes: dispute.session.endMinutes
				})}
				· {m.contracts_cycle_sessions_zone({ zone: dispute.session.timeZoneLabel })}
			</p>
			<p class="text-[12px] text-outline">
				{m.admin_disputes_parties({ family: dispute.familyName, helper: dispute.helperName })}
				· {m.admin_disputes_hours({ hours: hours(dispute.session.elapsedMinutes) })}
				· {dispute.policyVersion === null
					? m.admin_disputes_policy_none()
					: m.admin_disputes_policy({ version: dispute.policyVersion })}
			</p>
		</header>

		<section class="grid gap-3 md:grid-cols-2" data-testid="dispute-statements">
			<div class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
				<h2 class="mb-1 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
					{m.admin_disputes_reported_by({ name: dispute.reportedByName ?? '' })}
				</h2>
				<p class="text-[12px] text-outline">{formatDateTime(dispute.recordedAt)}</p>
				{#if dispute.reason}
					<p class="text-[13px] text-base-content-muted">
						{m.sessions_reason_line({
							reason: sessionReasonLabel(dispute.reason as Parameters<typeof sessionReasonLabel>[0])
						})}
					</p>
				{/if}
				{#if dispute.minutesWorked !== null}
					<p class="text-[13px] text-base-content-muted">
						{m.sessions_minutes_worked_line({
							worked: hours(dispute.minutesWorked),
							total: hours(dispute.session.elapsedMinutes)
						})}
					</p>
				{/if}
				<p class="mt-1 text-[13px] whitespace-pre-line text-base-content">
					{dispute.note ?? m.admin_disputes_no_statement()}
				</p>
			</div>
			<div class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
				<h2 class="mb-1 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
					{dispute.respondedByName
						? m.admin_disputes_answered_by({ name: dispute.respondedByName })
						: m.admin_disputes_no_answer()}
				</h2>
				{#if dispute.respondedAt}
					<p class="text-[12px] text-outline">{formatDateTime(dispute.respondedAt)}</p>
				{/if}
				<p class="mt-1 text-[13px] whitespace-pre-line text-base-content">
					{dispute.responseNote ?? m.admin_disputes_no_statement()}
				</p>
			</div>
		</section>

		<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
				{m.admin_disputes_messages_heading()}
			</h2>
			{#if dispute.messages.length === 0}
				<p class="text-[12.5px] text-base-content-muted">{m.admin_disputes_messages_none()}</p>
			{:else}
				<ul class="flex flex-col gap-2" data-testid="dispute-messages">
					{#each dispute.messages as message (message.id)}
						<li class="text-[13px]">
							<span class="font-semibold text-base-content">{message.senderName}</span>
							<span class="text-[11.5px] text-outline">· {formatDateTime(message.sentAt)}</span>
							<p class="whitespace-pre-line text-base-content-muted">{message.body}</p>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
				{m.admin_disputes_agreement_heading()}
			</h2>
			{#if dispute.agreement.length === 0}
				<p class="text-[12.5px] text-base-content-muted">{m.admin_disputes_agreement_none()}</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each dispute.agreement as signature (signature.id)}
						<li class="text-[13px]">
							<button
								type="button"
								class="font-semibold text-secondary hover:underline"
								onclick={() =>
									(openAgreement = openAgreement === signature.id ? null : signature.id)}
							>
								{m.admin_disputes_signed_by({
									name: signature.signerName ?? '',
									when: formatDateTime(signature.signedAt)
								})}
							</button>
							<span class="text-[11.5px] text-outline">
								· v{signature.contractVersion} · {signature.cancellationPolicyVersion === null
									? m.admin_disputes_policy_none()
									: m.admin_disputes_policy({ version: signature.cancellationPolicyVersion })}
							</span>
							{#if openAgreement === signature.id}
								<pre
									class="mt-2 max-h-96 overflow-auto rounded-lg bg-base-200 p-3 text-[12px] whitespace-pre-wrap">{signature.content}</pre>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
			<h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
				{m.admin_disputes_history_heading()}
			</h2>
			<ul class="flex flex-col gap-1 text-[12.5px]">
				{#each dispute.history as event (event.id)}
					<li>
						<span class="font-semibold text-base-content">{actionLabel(event.action)}</span>
						<span class="text-outline">
							· {event.actorName ?? m.admin_disputes_history_system()} · {formatDateTime(event.at)}
						</span>
						{#if event.note}
							<span class="block text-base-content-muted italic">“{event.note}”</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>

		{#if dispute.status === 'decided'}
			<section class="rounded-xl border border-success/40 bg-base-100 px-5 py-4">
				<h2 class="font-semibold text-base-content">
					{m.sessions_decided_line({
						outcome: dispute.decision ? resolutionKindLabel(dispute.decision) : ''
					})}
				</h2>
				<p class="text-[12px] text-outline">
					{m.admin_disputes_decided_by({
						name: dispute.decidedByName ?? '',
						when: dispute.decidedAt ? formatDateTime(dispute.decidedAt) : ''
					})}
				</p>
				<p class="mt-1 text-[13px] whitespace-pre-line text-base-content">
					{dispute.decisionReason}
				</p>
			</section>
		{:else if dispute.status === 'contested'}
			<form
				class="flex flex-col gap-3 rounded-xl border border-card-border bg-base-100 px-5 py-4"
				onsubmit={(event) => {
					event.preventDefault();
					void decide();
				}}
				data-testid="dispute-decide"
			>
				<h2 class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
					{m.admin_disputes_decide_heading()}
				</h2>
				<p class="text-[12px] text-base-content-muted">{m.admin_disputes_decide_note()}</p>
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-semibold text-base-content">{m.admin_disputes_outcome()}</span>
					<select class="select select-sm w-full max-w-md" bind:value={decision}>
						<option value="" disabled>{m.admin_disputes_outcome_choose()}</option>
						{#each outcomes as outcome (outcome)}
							<option value={outcome}>{resolutionKindLabel(outcome)}</option>
						{/each}
					</select>
				</label>
				{#if decision === 'family_reduced_hours'}
					<label class="flex flex-col gap-1 text-[12.5px]">
						<span class="font-semibold text-base-content">
							{m.sessions_field_minutes({ total: dispute.session.elapsedMinutes })}
						</span>
						<input
							type="number"
							min="0"
							step="1"
							class="input input-sm w-full max-w-xs"
							bind:value={minutesWorked}
						/>
					</label>
				{/if}
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-semibold text-base-content">{m.admin_disputes_reason()}</span>
					<textarea
						class="textarea textarea-sm w-full"
						rows="3"
						maxlength="2000"
						required
						bind:value={reason}
					></textarea>
				</label>
				<div>
					<button type="submit" class="btn btn-sm btn-primary" disabled={deciding}>
						{#if deciding}<span class="loading loading-xs loading-spinner"></span>{/if}
						{m.admin_disputes_decide()}
					</button>
				</div>
			</form>
		{/if}
	{/if}
</div>
