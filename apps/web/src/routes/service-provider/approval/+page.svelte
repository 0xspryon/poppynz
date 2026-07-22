<script lang="ts">
	import {
		getOnboardingHistory,
		getOnboardingState,
		submitApprovalRequest,
		type OnboardingHistory,
		type OnboardingState
	} from '$lib/api/onboarding';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';
	const DAY_MS = 24 * 60 * 60 * 1000;

	let onboarding = $state<OnboardingState | null>(null);
	let history = $state<OnboardingHistory | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	async function load() {
		errorMessage = '';
		const [stateResult, historyResult] = await Promise.all([
			getOnboardingState(),
			getOnboardingHistory()
		]);
		if (stateResult.ok && historyResult.ok) {
			onboarding = stateResult.data;
			history = historyResult.data;
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
		void load();
	});

	async function submit() {
		if (submitting) return;
		submitting = true;
		submitError = '';
		const result = await submitApprovalRequest();
		if (result.ok) {
			await load();
		} else {
			submitError =
				result.error.code === 'APPROVAL_REQUEST_ALREADY_SUBMITTED'
					? 'Your application is already with our review team.'
					: RETRY_MESSAGE;
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
		if (!history) return [];
		const now = Date.now();
		const list: Array<TimelineEvent> = [];

		// Oldest request first so resubmissions can be labelled.
		const requestsAsc = [...history.requests].reverse();
		requestsAsc.forEach((request, index) => {
			list.push({
				key: `${request.id}-submitted`,
				at: request.submittedAt,
				title: index === 0 ? 'Application submitted' : 'Application resubmitted',
				chip: 'submitted',
				dot: 'bg-primary'
			});
			if (request.status === 'rejected' && request.reviewedAt) {
				list.push({
					key: `${request.id}-rejected`,
					at: request.reviewedAt,
					title: 'Application rejected',
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
				title: 'Approval granted',
				chip: 'approved',
				detail: `Reviewed by Poppynz admin · valid until ${formatDate(approval.expiresAt)}`,
				dot: 'bg-success shadow-[0_0_0_4px] shadow-success-content'
			});
			if (approval.status === 'rejected' && approval.revokedAt) {
				list.push({
					key: `${approval.id}-revoked`,
					at: approval.revokedAt,
					title: 'Approval revoked',
					chip: 'rejected',
					chipLabel: 'Revoked',
					reason: approval.reason ?? undefined,
					dot: 'bg-error'
				});
			} else if (new Date(approval.expiresAt).getTime() < now) {
				list.push({
					key: `${approval.id}-expired`,
					at: approval.expiresAt,
					title: 'Approval expired',
					chip: 'expired',
					detail: `Approval granted ${formatDate(approval.grantedAt)} ran its term.`,
					dot: 'bg-outline-variant'
				});
			}
		}

		return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	});

	const approval = $derived(onboarding?.approval ?? null);
	const latestRequest = $derived(onboarding?.latestApprovalRequest ?? null);
	// Most recent approval was revoked and nothing newer is pending — show the
	// revoked hero so the reason is front and center.
	const revokedApproval = $derived.by(() => {
		if (approval || latestRequest?.status === 'submitted') return null;
		const latest = history?.approvals[0];
		return latest?.status === 'rejected' ? latest : null;
	});
	const daysRemaining = $derived(
		approval ? Math.max(0, Math.floor((new Date(approval.expiresAt).getTime() - Date.now()) / DAY_MS)) : 0
	);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-CA', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Approval · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Approval</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Your verification status, and every request and approval over time.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<!-- Current status hero -->
		{#if approval}
			<div
				class="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-success-content
					bg-base-100 px-6 py-5"
			>
				<span
					class="flex size-13 shrink-0 items-center justify-center rounded-full bg-success-content"
				>
					<i class="las la-user-shield text-2xl text-success" aria-hidden="true"></i>
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2.5">
						<span class="font-display text-lg font-bold text-base-content">Verified Mom Helper</span>
						<StatusChip status="approved" />
					</div>
					<p class="mt-0.5 text-[13px] text-base-content-muted">
						Current approval valid until
						<b class="text-base-content">{formatDate(approval.expiresAt)}</b>
						· granted {formatDate(approval.grantedAt)} · we'll remind you before it expires.
					</p>
				</div>
				<div class="shrink-0 text-right">
					<div class="font-display text-2xl font-bold text-success">{daysRemaining}</div>
					<div class="text-xs text-outline">days remaining</div>
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
						<span class="font-display text-lg font-bold text-base-content">Under review</span>
						<StatusChip status="submitted" />
					</div>
					<p class="mt-0.5 text-[13px] text-base-content-muted">
						Submitted {formatDate(latestRequest.submittedAt)} — an admin usually reviews within ~2
						days. We'll email you.
					</p>
				</div>
			</div>
		{:else if revokedApproval}
			<div class="mb-6 rounded-lg border border-error-content bg-base-100 px-6 py-5">
				<div class="flex flex-wrap items-center gap-4">
					<span
						class="flex size-13 shrink-0 items-center justify-center rounded-full bg-error-content"
					>
						<i class="las la-user-slash text-2xl text-error" aria-hidden="true"></i>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2.5">
							<span class="font-display text-lg font-bold text-base-content">
								Approval revoked
							</span>
							<StatusChip status="rejected" label="Revoked" />
						</div>
						<p class="mt-0.5 text-[13px] text-base-content-muted">
							Revocation isn't a ban — fix the issue below, then resubmit for review.
						</p>
					</div>
					<button
						type="button"
						class="btn btn-primary"
						disabled={submitting}
						onclick={() => void submit()}
					>
						{#if submitting}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Resubmit for review
					</button>
				</div>
				{#if revokedApproval.reason}
					<p
						class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
							py-2.5 text-[12.5px] leading-relaxed text-error"
					>
						<b>Reason:</b>
						{revokedApproval.reason}
					</p>
				{/if}
			</div>
		{:else if latestRequest?.status === 'rejected'}
			<div
				class="mb-6 rounded-lg border border-error-content bg-base-100 px-6 py-5"
			>
				<div class="flex flex-wrap items-center gap-4">
					<span
						class="flex size-13 shrink-0 items-center justify-center rounded-full bg-error-content"
					>
						<i class="las la-exclamation-circle text-2xl text-error" aria-hidden="true"></i>
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2.5">
							<span class="font-display text-lg font-bold text-base-content">
								Application rejected
							</span>
							<StatusChip status="rejected" />
						</div>
						<p class="mt-0.5 text-[13px] text-base-content-muted">
							Rejection isn't final — fix the issue below and resubmit.
						</p>
					</div>
					<button
						type="button"
						class="btn btn-primary"
						disabled={submitting}
						onclick={() => void submit()}
					>
						{#if submitting}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Resubmit for review
					</button>
				</div>
				{#if latestRequest.reason}
					<p
						class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
							py-2.5 text-[12.5px] leading-relaxed text-error"
					>
						<b>Reason:</b>
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
					<span class="font-display text-lg font-bold text-base-content">Not submitted yet</span>
					<p class="mt-0.5 text-[13px] text-base-content-muted">
						Submit your application when you're ready — warnings don't block submission.
					</p>
				</div>
				<button
					type="button"
					class="btn btn-primary"
					disabled={submitting}
					onclick={() => void submit()}
				>
					{#if submitting}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Submit for review
				</button>
			</div>
		{/if}

		{#if submitError}
			<p role="alert" class="mb-4 text-sm font-medium text-error">{submitError}</p>
		{/if}

		<!-- History timeline -->
		{#if events.length > 0}
			<div class="mb-3.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				History
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
									<b>Reason:</b>
									{event.reason}
								</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="rounded-lg border border-card-border bg-base-100 p-6 text-sm text-base-content-muted">
				No history yet — your submissions and decisions will appear here.
			</p>
		{/if}
	{/if}
</div>
