<script lang="ts">
	/** Approval standing (screen 9d) as a data-in panel: the current-status
	 * hero with the submit / resubmit action, then the request and approval
	 * history. The caller owns loading and refetches through `onchanged`, so
	 * the standalone Approval page and the merged Verification page share it. */
	import {
		submitApprovalRequest,
		type OnboardingHistory,
		type OnboardingState
	} from '$lib/api/onboarding';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDate } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { approvalIncompleteText } from './error-messages';

	interface Props {
		role: 'family' | 'service-provider';
		hub: Pick<OnboardingState, 'approval' | 'latestApprovalRequest'>;
		history: OnboardingHistory;
		vouchCount?: number | null;
		onchanged: () => Promise<void>;
	}

	let { role, hub, history, vouchCount = null, onchanged }: Props = $props();

	const RETRY_MESSAGE = m.common_error_generic();
	const DAY_MS = 24 * 60 * 60 * 1000;
	const RECOMMENDED_VOUCHES = 2;

	let submitting = $state(false);
	let nudgeOpen = $state(false);

	/** Vouches are a nudge, never a gate: fewer than recommended asks once,
	 * then submits anyway. Families (vouchCount null) go straight through. */
	function requestSubmit() {
		if (vouchCount !== null && vouchCount < RECOMMENDED_VOUCHES) {
			nudgeOpen = true;
			return;
		}
		void submit();
	}

	const verifiedLabel = $derived(
		role === 'family' ? m.approval_verified_family() : m.approval_verified_provider()
	);

	async function submit() {
		if (submitting) return;
		submitting = true;
		const result = await submitApprovalRequest();
		if (result.ok) {
			toast.success(m.approval_toast_submitted(), {
				title: m.approval_toast_submitted_title()
			});
			await onchanged();
		} else {
			toast.error(
				result.error.code === 'APPROVAL_REQUEST_ALREADY_SUBMITTED'
					? m.approval_toast_already_submitted()
					: result.error.code === 'APPROVAL_REQUEST_INCOMPLETE'
						? // UAT #12: say what is still needed before it can be submitted.
							approvalIncompleteText(result.error.blockers)
						: RETRY_MESSAGE,
				{ title: m.approval_toast_not_submitted_title() }
			);
		}
		submitting = false;
	}

	interface TimelineEvent {
		key: string;
		at: string;
		title: string;
		chip: ChipStatus;
		chipLabel?: string;
		detail?: string;
		reason?: string;
		dot: string;
	}

	const events = $derived.by((): Array<TimelineEvent> => {
		const now = Date.now();
		const list: Array<TimelineEvent> = [];

		// Oldest request first so resubmissions can be labelled.
		const requestsAsc = [...history.requests].reverse();
		requestsAsc.forEach((request, index) => {
			list.push({
				key: `${request.id}-submitted`,
				at: request.submittedAt,
				title: index === 0 ? m.approval_event_submitted() : m.approval_event_resubmitted(),
				chip: 'submitted',
				dot: 'bg-primary'
			});
			if (request.status === 'rejected' && request.reviewedAt) {
				list.push({
					key: `${request.id}-rejected`,
					at: request.reviewedAt,
					title: m.approval_event_rejected(),
					chip: 'rejected',
					reason: request.reason ?? undefined,
					dot: 'bg-error'
				});
			}
		});

		for (const approval of history.approvals) {
			list.push({
				key: `${approval.id}-granted`,
				at: approval.grantedAt,
				title: m.approval_event_granted(),
				chip: 'approved',
				detail: m.approval_event_granted_detail({ date: formatDate(approval.expiresAt) }),
				dot: 'bg-success shadow-[0_0_0_4px] shadow-success-content'
			});
			if (approval.status === 'rejected' && approval.revokedAt) {
				list.push({
					key: `${approval.id}-revoked`,
					at: approval.revokedAt,
					title: m.approval_event_revoked(),
					chip: 'rejected',
					chipLabel: m.approval_chip_revoked(),
					reason: approval.reason ?? undefined,
					dot: 'bg-error'
				});
			} else if (new Date(approval.expiresAt).getTime() < now) {
				list.push({
					key: `${approval.id}-expired`,
					at: approval.expiresAt,
					title: m.approval_event_expired(),
					chip: 'expired',
					detail: m.approval_event_expired_detail({ date: formatDate(approval.grantedAt) }),
					dot: 'bg-outline-variant'
				});
			}
		}

		return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	});

	const approval = $derived(hub.approval);
	const latestRequest = $derived(hub.latestApprovalRequest);
	// Most recent approval was revoked and nothing newer is pending — show the
	// revoked hero so the reason is front and center.
	const revokedApproval = $derived.by(() => {
		if (approval || latestRequest?.status === 'submitted') return null;
		const latest = history.approvals[0];
		return latest?.status === 'rejected' ? latest : null;
	});
	const daysRemaining = $derived(
		approval
			? Math.max(0, Math.floor((new Date(approval.expiresAt).getTime() - Date.now()) / DAY_MS))
			: 0
	);
</script>

<!-- Current status hero -->
{#if approval}
	<div
		class="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-success-content
			bg-base-100 px-6 py-5"
	>
		<span class="flex size-13 shrink-0 items-center justify-center rounded-full bg-success-content">
			<i class="las la-user-shield text-2xl text-success" aria-hidden="true"></i>
		</span>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2.5">
				<span class="font-display text-lg font-bold text-base-content">{verifiedLabel}</span>
				<StatusChip status="approved" />
			</div>
			<p class="mt-0.5 text-[13px] text-base-content-muted">
				{m.approval_current_valid_until_before()}
				<b class="text-base-content">{formatDate(approval.expiresAt)}</b>
				{m.approval_current_valid_until_after({ date: formatDate(approval.grantedAt) })}
			</p>
		</div>
		<div class="shrink-0 text-right">
			<div class="font-display text-2xl font-bold text-success">{daysRemaining}</div>
			<div class="text-xs text-outline">
				{m.approval_days_remaining({ count: daysRemaining })}
			</div>
		</div>
	</div>
{:else if latestRequest?.status === 'submitted'}
	<div
		class="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-info-content
			bg-base-100 px-6 py-5"
	>
		<span class="flex size-13 shrink-0 items-center justify-center rounded-full bg-info-content">
			<i class="las la-hourglass-half text-2xl text-info" aria-hidden="true"></i>
		</span>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2.5">
				<span class="font-display text-lg font-bold text-base-content"
					>{m.approval_under_review()}</span
				>
				<StatusChip status="submitted" />
			</div>
			<p class="mt-0.5 text-[13px] text-base-content-muted">
				{m.approval_under_review_detail({ date: formatDate(latestRequest.submittedAt) })}
			</p>
		</div>
	</div>
{:else if revokedApproval}
	<div class="mb-6 rounded-lg border border-error-content bg-base-100 px-6 py-5">
		<div class="flex flex-wrap items-center gap-4">
			<span class="flex size-13 shrink-0 items-center justify-center rounded-full bg-error-content">
				<i class="las la-user-slash text-2xl text-error" aria-hidden="true"></i>
			</span>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2.5">
					<span class="font-display text-lg font-bold text-base-content">
						{m.approval_revoked_heading()}
					</span>
					<StatusChip status="rejected" label={m.approval_chip_revoked()} />
				</div>
				<p class="mt-0.5 text-[13px] text-base-content-muted">
					{m.approval_revoked_detail()}
				</p>
			</div>
			<button type="button" class="btn btn-primary" disabled={submitting} onclick={requestSubmit}>
				{#if submitting}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				{m.approval_resubmit()}
			</button>
		</div>
		{#if revokedApproval.reason}
			<p
				class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
					py-2.5 text-[12.5px] leading-relaxed text-error"
			>
				<b>{m.approval_reason_label()}</b>
				{revokedApproval.reason}
			</p>
		{/if}
	</div>
{:else if latestRequest?.status === 'rejected'}
	<div class="mb-6 rounded-lg border border-error-content bg-base-100 px-6 py-5">
		<div class="flex flex-wrap items-center gap-4">
			<span class="flex size-13 shrink-0 items-center justify-center rounded-full bg-error-content">
				<i class="las la-exclamation-circle text-2xl text-error" aria-hidden="true"></i>
			</span>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2.5">
					<span class="font-display text-lg font-bold text-base-content">
						{m.approval_rejected_heading()}
					</span>
					<StatusChip status="rejected" />
				</div>
				<p class="mt-0.5 text-[13px] text-base-content-muted">
					{m.approval_rejected_detail()}
				</p>
			</div>
			<button type="button" class="btn btn-primary" disabled={submitting} onclick={requestSubmit}>
				{#if submitting}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				{m.approval_resubmit()}
			</button>
		</div>
		{#if latestRequest.reason}
			<p
				class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
					py-2.5 text-[12.5px] leading-relaxed text-error"
			>
				<b>{m.approval_reason_label()}</b>
				{latestRequest.reason}
			</p>
		{/if}
	</div>
{:else}
	<div
		class="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-card-border
			bg-base-100 px-6 py-5"
	>
		<span class="flex size-13 shrink-0 items-center justify-center rounded-full bg-base-300">
			<i class="las la-user-shield text-2xl text-outline" aria-hidden="true"></i>
		</span>
		<div class="min-w-0 flex-1">
			<span class="font-display text-lg font-bold text-base-content"
				>{m.approval_not_submitted_heading()}</span
			>
			<p class="mt-0.5 text-[13px] text-base-content-muted">
				{role === 'family'
					? m.approval_not_submitted_detail_family()
					: m.approval_not_submitted_detail_provider()}
			</p>
		</div>
		<button type="button" class="btn btn-primary" disabled={submitting} onclick={requestSubmit}>
			{#if submitting}
				<span class="loading loading-spinner loading-sm"></span>
			{/if}
			{m.approval_submit()}
		</button>
	</div>
{/if}

<!-- History timeline -->
{#if events.length > 0}
	<div class="mb-3.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
		{m.approval_history_heading()}
	</div>
	<div class="rounded-lg border border-card-border bg-base-100 p-6 lg:p-7">
		{#each events as event, index (event.key)}
			<div class="flex gap-4">
				<div class="flex flex-col items-center">
					<span class="mt-1 size-3.5 shrink-0 rounded-full {event.dot}"></span>
					{#if index < events.length - 1}
						<span class="mt-1 w-0.5 flex-1 bg-base-300"></span>
					{/if}
				</div>
				<div class="min-w-0 flex-1 {index < events.length - 1 ? 'pb-5' : ''}">
					<div class="flex flex-wrap items-center gap-2.5">
						<span class="font-display text-[15px] font-bold text-base-content">
							{event.title}
						</span>
						<StatusChip status={event.chip} label={event.chipLabel} />
						<span class="text-xs text-outline">{formatDate(event.at)}</span>
					</div>
					{#if event.detail}
						<p class="mt-1.5 text-[13px] leading-relaxed text-base-content-muted">
							{event.detail}
						</p>
					{/if}
					{#if event.reason}
						<p
							class="mt-1.5 max-w-xl rounded-md border border-error-content bg-error-content/40
								px-3.5 py-2.5 text-[12.5px] leading-relaxed text-error"
						>
							<b>{m.approval_reason_label()}</b>
							{event.reason}
						</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<p class="rounded-lg border border-card-border bg-base-100 p-6 text-sm text-base-content-muted">
		{m.approval_history_empty()}
	</p>
{/if}

<ConfirmDialog
	open={nudgeOpen}
	title={m.approval_nudge_title()}
	body={m.approval_nudge_body({ count: vouchCount ?? 0, total: RECOMMENDED_VOUCHES })}
	confirmLabel={m.approval_nudge_confirm()}
	confirmClass="btn-primary"
	busy={submitting}
	onconfirm={() => {
		nudgeOpen = false;
		void submit();
	}}
	oncancel={() => (nudgeOpen = false)}
/>
