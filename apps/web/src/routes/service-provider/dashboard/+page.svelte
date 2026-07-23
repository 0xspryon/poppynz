<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		getOnboardingState,
		submitApprovalRequest,
		type OnboardingState,
		type SubmitApprovalRequestError
	} from '$lib/api/onboarding';
	import StatusChip from '$lib/components/StatusChip.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let onboarding = $state<OnboardingState | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	async function load() {
		loading = onboarding === null;
		errorMessage = '';
		const result = await getOnboardingState();
		if (result.ok) {
			onboarding = result.data;
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
		void load();
	});

	function submitErrorText(error: SubmitApprovalRequestError): string {
		switch (error.code) {
			case 'APPROVAL_REQUEST_ALREADY_SUBMITTED':
				return 'Your application is already with our review team.';
			case 'INVALID_APPROVAL_REQUEST':
				return error.message;
			default:
				return RETRY_MESSAGE;
		}
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		submitError = '';
		const result = await submitApprovalRequest();
		if (result.ok) {
			await load();
		} else {
			submitError = submitErrorText(result.error);
		}
		submitting = false;
	}

	const firstName = $derived(onboarding?.firstName ?? null);
	const progress = $derived(onboarding?.progress ?? { completed: 0, total: 1 });
	const warnings = $derived(onboarding?.warnings ?? null);
	const recommendationCount = $derived(
		warnings
			? warnings.missingRequiredDocuments.length + (warnings.missingServicesOffered ? 1 : 0)
			: 0
	);
	const recommendationText = $derived.by(() => {
		if (!warnings) return '';
		const parts = [
			...warnings.missingRequiredDocuments.map((doc) => `${doc.name.toLowerCase()} missing`),
			...(warnings.missingServicesOffered ? ['no services listed'] : [])
		];
		return parts.join(' · ');
	});
	const requestStatus = $derived(onboarding?.latestApprovalRequest?.status ?? null);
	const approved = $derived(onboarding?.approval != null);
</script>

<svelte:head>
	<title>Dashboard · Poppynz</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if onboarding}
	<div class="mx-auto max-w-4xl">
		<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
			Welcome{firstName ? `, ${firstName}` : ''}
		</h1>
		<p class="mt-1 text-sm text-base-content-muted">
			Your home base — finish these at your own pace, in any order.
		</p>

		<div class="mt-5 flex items-center gap-3.5">
			<progress
				class="progress h-2 flex-1 progress-primary"
				value={progress.completed}
				max={progress.total}
			></progress>
			<span class="shrink-0 text-xs font-semibold text-neutral">
				{progress.completed} of {progress.total} tasks done
			</span>
		</div>

		{#if recommendationCount > 0 && !approved && requestStatus !== 'submitted'}
			<div
				class="mt-4 flex items-center gap-3 rounded-[10px] border border-warning-border
					bg-warning-content/40 px-4 py-3"
			>
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent
						text-accent-content"
				>
					<i class="las la-exclamation text-sm" aria-hidden="true"></i>
				</span>
				<span class="text-sm font-medium text-warning">
					{recommendationCount}
					{recommendationCount === 1 ? 'recommendation' : 'recommendations'} before you submit:
					{recommendationText}. {recommendationCount === 1 ? 'It' : 'Neither'} blocks submission.
				</span>
			</div>
		{/if}

		<div class="mt-5 grid gap-3.5 sm:grid-cols-2">
			<!-- Profile -->
			<div
				class="flex flex-col rounded-lg border bg-base-100 p-5
					{onboarding.steps.profile.complete ? 'border-card-border' : 'border-warning-border'}"
			>
				<div class="mb-3 flex items-center justify-between">
					{#if onboarding.steps.profile.complete}
						<span class="flex size-8 items-center justify-center rounded-full bg-success">
							<i class="las la-check text-sm text-success-content" aria-hidden="true"></i>
						</span>
						<StatusChip status="complete" />
					{:else}
						<span
							class="flex size-8 items-center justify-center rounded-full bg-accent font-mono
								text-xs font-bold text-accent-content"
						>
							1
						</span>
						<StatusChip status="missing" label="Incomplete" />
					{/if}
				</div>
				<div class="font-display text-base font-bold text-base-content">Your profile</div>
				<p class="mt-0.5 mb-3.5 text-xs leading-relaxed text-base-content-muted">
					{onboarding.steps.profile.complete
						? 'Contact, location & bio — done. Families see this first.'
						: 'Contact, location & bio — families see this first.'}
				</p>
				<a
					href={resolve('/service-provider/profile')}
					class="mt-auto text-[13px] font-semibold text-primary"
				>
					Edit profile →
				</a>
			</div>

			<!-- Documents -->
			<div
				class="flex flex-col rounded-lg border bg-base-100 p-5
					{onboarding.steps.documents.complete ? 'border-card-border' : 'border-warning-border'}"
			>
				<div class="mb-3 flex items-center justify-between">
					{#if onboarding.steps.documents.complete}
						<span class="flex size-8 items-center justify-center rounded-full bg-success">
							<i class="las la-check text-sm text-success-content" aria-hidden="true"></i>
						</span>
						<StatusChip status="complete" />
					{:else}
						<span
							class="flex size-8 items-center justify-center rounded-full bg-accent font-mono
								text-xs font-bold text-accent-content"
						>
							2
						</span>
						<StatusChip
							status="missing"
							label="{onboarding.steps.documents.requiredTotal -
								onboarding.steps.documents.requiredSubmitted} missing"
						/>
					{/if}
				</div>
				<div class="font-display text-base font-bold text-base-content">Your documents</div>
				<p class="mt-0.5 mb-3.5 text-xs leading-relaxed text-base-content-muted">
					{onboarding.steps.documents.requiredSubmitted} of {onboarding.steps.documents
						.requiredTotal} submitted.
					{#if warnings && warnings.missingRequiredDocuments.length > 0}
						{warnings.missingRequiredDocuments[0].name} is still needed.
					{/if}
				</p>
				<a
					href={resolve('/service-provider/documents')}
					class="mt-auto text-[13px] font-semibold text-primary"
				>
					Upload documents →
				</a>
			</div>

			<!-- Services & rates -->
			<div
				class="flex flex-col rounded-lg border bg-base-100 p-5
					{onboarding.steps.services.complete ? 'border-card-border' : 'border-warning-border'}"
			>
				<div class="mb-3 flex items-center justify-between">
					{#if onboarding.steps.services.complete}
						<span class="flex size-8 items-center justify-center rounded-full bg-success">
							<i class="las la-check text-sm text-success-content" aria-hidden="true"></i>
						</span>
						<StatusChip status="complete" />
					{:else}
						<span
							class="flex size-8 items-center justify-center rounded-full bg-accent font-mono
								text-xs font-bold text-accent-content"
						>
							3
						</span>
						<StatusChip status="empty" />
					{/if}
				</div>
				<div class="font-display text-base font-bold text-base-content">Services & rates</div>
				<p class="mt-0.5 mb-3.5 text-xs leading-relaxed text-base-content-muted">
					{onboarding.steps.services.complete
						? `${onboarding.steps.services.count} listed — this is your shop window for families.`
						: 'Nothing listed yet — this is your shop window for families.'}
				</p>
				<a
					href={resolve('/service-provider/services')}
					class="mt-auto text-[13px] font-semibold text-primary"
				>
					Add a service →
				</a>
			</div>

			<!-- Submit for review -->
			<div class="flex flex-col rounded-lg bg-secondary p-5">
				{#if approved}
					<div class="font-display text-base font-bold text-secondary-content">You're approved</div>
					<p class="mt-0.5 mb-4 text-xs leading-relaxed text-secondary-content-muted">
						Families can find you. Everything here stays editable.
					</p>
					<a
						href={resolve('/service-provider/approval')}
						class="btn mt-auto btn-primary"
					>
						View approval
					</a>
				{:else if requestStatus === 'submitted'}
					<div class="font-display text-base font-bold text-secondary-content">Under review</div>
					<p class="mt-0.5 mb-4 text-xs leading-relaxed text-secondary-content-muted">
						Your application is with our review team — usually ~2 days. We'll email you.
					</p>
					<a
						href={resolve('/service-provider/approval')}
						class="btn mt-auto btn-outline text-secondary-content hover:bg-secondary-content/10"
					>
						View status
					</a>
				{:else}
					<div class="font-display text-base font-bold text-secondary-content">
						{requestStatus === 'rejected' ? 'Fix & resubmit' : 'Submit for review'}
					</div>
					<p class="mt-0.5 mb-4 text-xs leading-relaxed text-secondary-content-muted">
						{requestStatus === 'rejected'
							? 'Your last application was rejected — check the reason, fix it, and resubmit.'
							: 'You can submit anytime — even with the gaps above. An admin reviews within ~2 days.'}
					</p>
					{#if submitError}
						<p role="alert" class="mb-2 text-xs font-medium text-error-content/90">
							{submitError}
						</p>
					{/if}
					<button
						type="button"
						class="btn mt-auto btn-primary"
						disabled={submitting}
						onclick={submit}
					>
						{#if submitting}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						{requestStatus === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
					</button>
				{/if}
			</div>
		</div>

		<p class="mt-5 flex items-center gap-2 text-xs text-outline">
			<i class="las la-user-shield text-base" aria-hidden="true"></i>
			Everything here stays editable after you're approved — this dashboard is your permanent home.
		</p>
	</div>
{/if}
