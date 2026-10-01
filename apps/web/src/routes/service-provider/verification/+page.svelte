<script lang="ts">
	/** Verification: Documents, Safety verification and Approval merged into
	 * one page, read top to bottom as Identity → Background check → Poppynz
	 * review. One load feeds every section; each section is the same panel the
	 * family's separate pages use. */
	import { onMount, tick } from 'svelte';
	import {
		getOnboardingHistory,
		getOnboardingState,
		type OnboardingHistory,
		type OnboardingState
	} from '$lib/api/onboarding';
	import {
		getSafetyVerification,
		type SafetyVerificationState
	} from '$lib/api/safety-verification';
	import { getMyVouches, type MyVouches } from '$lib/api/vouches';
	import ApplicantVouchesPanel from '$lib/components/vouches/ApplicantVouchesPanel.svelte';
	import ApprovalPanel from '$lib/components/verification/ApprovalPanel.svelte';
	import DocumentChecklist from '$lib/components/verification/DocumentChecklist.svelte';
	import SafetyCheckPanel from '$lib/components/verification/SafetyCheckPanel.svelte';
	import { notifications } from '$lib/notifications.svelte';

	type StepId = 'identity' | 'background-check' | 'review';
	type StepState = 'done' | 'progress' | 'attention' | 'todo';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let onboarding = $state<OnboardingState | null>(null);
	let safety = $state<SafetyVerificationState | null>(null);
	let history = $state<OnboardingHistory | null>(null);
	let vouches = $state<MyVouches | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	/** Re-reads everything without blanking the page, so a section's own
	 * spinner or dialog survives the refresh it triggered. */
	async function load() {
		const [stateResult, safetyResult, historyResult, vouchesResult] = await Promise.all([
			getOnboardingState(),
			getSafetyVerification(),
			getOnboardingHistory(),
			getMyVouches()
		]);
		if (stateResult.ok && safetyResult.ok && historyResult.ok && vouchesResult.ok) {
			onboarding = stateResult.data;
			safety = safetyResult.data;
			history = historyResult.data;
			vouches = vouchesResult.data;
			errorMessage = '';
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	function scrollToStep(id: StepId) {
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// onMount, not $effect: load() writes the state an effect would track.
	onMount(() => {
		void load().then(async () => {
			// Old /documents and /approval links land here with a fragment; the
			// sections only exist once the data is in, so scroll by hand.
			const target = window.location.hash.slice(1);
			if (target === 'identity' || target === 'background-check' || target === 'review') {
				await tick();
				scrollToStep(target);
			}
		});
		const unsubscribers = [
			notifications.on('safety_verification.updated', () => void load()),
			notifications.on('approval.decided', () => void load()),
			notifications.on('approval.revoked', () => void load()),
			notifications.on('vouch.updated', () => void load())
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	});

	const documents = $derived(onboarding?.documents ?? []);
	// The safety-gate type is the background check's own evidence, so it sits
	// with the check rather than with the identity documents.
	const identityDocs = $derived(documents.filter((doc) => !doc.isSafetyGate));
	const gateDocs = $derived(documents.filter((doc) => doc.isSafetyGate));
	const queuedTypeIds = $derived(safety?.basket.map((entry) => entry.documentTypeId) ?? []);

	const identityState = $derived.by((): StepState => {
		const required = identityDocs.filter((doc) => !doc.isOptional);
		if (required.some((doc) => doc.status === 'rejected')) return 'attention';
		const submitted = required.filter((doc) => doc.status !== 'missing').length;
		if (submitted === required.length) return 'done';
		return submitted > 0 ? 'progress' : 'todo';
	});

	const backgroundState = $derived.by((): StepState => {
		switch (safety?.verification.status) {
			case 'verified':
				return 'done';
			case 'rejected':
			case 'expired':
				return 'attention';
			case 'payment_pending':
			case 'invited':
			case 'in_progress':
			case 'review_required':
				return 'progress';
			default:
				return 'todo';
		}
	});

	const reviewState = $derived.by((): StepState => {
		if (!onboarding) return 'todo';
		if (onboarding.approval) return 'done';
		const latest = onboarding.latestApprovalRequest;
		if (latest?.status === 'submitted') return 'progress';
		if (latest?.status === 'rejected' || history?.approvals[0]?.status === 'rejected') {
			return 'attention';
		}
		return 'todo';
	});

	const steps = $derived<Array<{ id: StepId; label: string; state: StepState }>>([
		{ id: 'identity', label: 'Identity', state: identityState },
		{ id: 'background-check', label: 'Background check', state: backgroundState },
		{ id: 'review', label: 'Poppynz review', state: reviewState }
	]);

	const stateText: Record<StepState, string> = {
		done: 'Done',
		progress: 'In progress',
		attention: 'Needs attention',
		todo: 'To do'
	};
</script>

<svelte:head>
	<title>Verification · Poppynz</title>
</svelte:head>

{#snippet stepBadge(index: number, stepState: StepState)}
	<span
		class="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold
			{stepState === 'done'
			? 'bg-success text-success-content'
			: stepState === 'attention'
				? 'bg-error-content text-error'
				: stepState === 'progress'
					? 'bg-info-content text-info'
					: 'bg-base-300 text-outline'}"
		aria-hidden="true"
	>
		{#if stepState === 'done'}
			<i class="las la-check"></i>
		{:else if stepState === 'attention'}
			<i class="las la-exclamation"></i>
		{:else if stepState === 'progress'}
			<i class="las la-hourglass-half"></i>
		{:else}
			{index + 1}
		{/if}
	</span>
{/snippet}

{#snippet sectionHeading(index: number, title: string, text: string)}
	{@const step = steps[index]}
	<div class="mb-4 flex items-start gap-3">
		{@render stepBadge(index, step.state)}
		<div class="min-w-0">
			<h2 class="font-display text-lg font-bold text-base-content">{title}</h2>
			<p class="mt-0.5 text-sm text-base-content-muted">{text}</p>
		</div>
	</div>
{/snippet}

<div class="mx-auto max-w-4xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Verification</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Three steps to becoming a verified Poppynz helper. Your ID is never shown to families.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage && !onboarding}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if onboarding && safety && history && vouches}
		<nav aria-label="Verification steps">
			<ol class="grid gap-2.5 sm:grid-cols-3">
				{#each steps as step, index (step.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-lg border border-card-border
								bg-base-100 px-4 py-3 text-left shadow-card transition-colors hover:border-primary"
							onclick={() => scrollToStep(step.id)}
						>
							{@render stepBadge(index, step.state)}
							<span class="min-w-0">
								<span class="block text-sm font-semibold text-base-content">{step.label}</span>
								<span class="block text-xs text-base-content-muted">{stateText[step.state]}</span>
							</span>
						</button>
					</li>
				{/each}
			</ol>
		</nav>

		<section id="identity" class="mt-8 scroll-mt-6">
			{@render sectionHeading(
				0,
				'Identity',
				'Upload a government-issued ID and any other documents we ask for. They are never shown publicly.'
			)}
			<DocumentChecklist
				documents={identityDocs}
				{queuedTypeIds}
				onchanged={load}
				oncheckList={() => scrollToStep('background-check')}
				checkListPlace="the Background check step"
			/>
		</section>

		<section id="background-check" class="mt-10 scroll-mt-6">
			{@render sectionHeading(
				1,
				'Background check',
				'Every Poppynz helper completes a safety check before taking bookings.'
			)}
			{#if gateDocs.length > 0}
				<div class="mb-4">
					<DocumentChecklist
						documents={gateDocs}
						{queuedTypeIds}
						onchanged={load}
						oncheckList={() => scrollToStep('background-check')}
						checkListPlace="your check list below"
						showRequiredHeading={false}
						emptyRequiredText=""
					/>
				</div>
			{/if}
			<SafetyCheckPanel
				summary={safety}
				onchanged={load}
				ondocuments={() => scrollToStep('identity')}
				documentsPlace="the list above"
				showDocumentsButton={false}
			/>
		</section>

		<section id="vouches" class="mt-10 scroll-mt-6">
			<h2 class="mb-4 font-display text-lg font-bold text-base-content">Vouches</h2>
			<ApplicantVouchesPanel data={vouches} onchanged={load} />
		</section>

		<section id="review" class="mt-10 scroll-mt-6">
			{@render sectionHeading(
				2,
				'Poppynz review',
				'Our team reviews your profile and lets you know if anything else is needed.'
			)}
			<ApprovalPanel
				role="service-provider"
				hub={onboarding}
				{history}
				vouchCount={vouches.counting}
				onchanged={load}
			/>
		</section>
	{/if}
</div>
