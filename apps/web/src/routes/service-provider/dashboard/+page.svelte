<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		getOnboardingState,
		submitApprovalRequest,
		type OnboardingState,
		type SubmitApprovalRequestError
	} from '$lib/api/onboarding';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let onboarding = $state<OnboardingState | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');
	let submitting = $state(false);

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

	// onMount, not $effect: load() reads `onboarding` synchronously, so an
	// effect would track it and re-run on every response — an infinite
	// request loop against /me/onboarding.
	onMount(() => {
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
		const result = await submitApprovalRequest();
		if (result.ok) {
			toast.success(
				'Your application is with our review team — expect a decision within ~2 days.',
				{
					title: 'Submitted for review'
				}
			);
			await load();
		} else {
			toast.error(submitErrorText(result.error), { title: 'Submission failed' });
		}
		submitting = false;
	}

	interface StepCard {
		key: string;
		short: string;
		icon: string;
		/** Tint of the icon tile — sky and pink as accents on white cards. */
		tint: string;
		title: string;
		body: string;
		detail: string | null;
		complete: boolean;
		href: ResolvedPathname;
		cta: string;
	}

	const firstName = $derived(onboarding?.firstName ?? null);
	const requestStatus = $derived(onboarding?.latestApprovalRequest?.status ?? null);
	const approved = $derived(onboarding?.approval != null);

	const cards = $derived.by((): Array<StepCard> => {
		if (!onboarding) return [];
		const { profile, documents, services } = onboarding.steps;
		return [
			{
				key: 'profile',
				short: 'Profile',
				icon: 'la-user-edit',
				tint: 'bg-base-400 text-neutral',
				title: 'Tell families about yourself',
				body: 'Add your photo, location and a short introduction.',
				detail: null,
				complete: profile.complete,
				href: resolve('/service-provider/profile'),
				cta: profile.complete ? 'Edit profile' : 'Complete profile'
			},
			{
				key: 'identity',
				short: 'Identity',
				icon: 'la-id-card',
				tint: 'bg-warning-content text-accent',
				title: 'Verify your identity',
				body: "Upload a government-issued ID. It's never shown to families.",
				detail:
					!documents.complete && documents.requiredTotal > 1
						? `${documents.requiredSubmitted} of ${documents.requiredTotal} documents submitted`
						: null,
				complete: documents.complete,
				href: resolve('/service-provider/verification'),
				cta: documents.complete ? 'View verification' : 'Upload ID'
			},
			{
				key: 'services',
				short: 'Services',
				icon: 'la-hand-holding-heart',
				tint: 'bg-base-400 text-neutral',
				title: 'Choose your services & rates',
				body: 'Let families know how you can help and what you charge.',
				detail: null,
				complete: services.complete,
				href: resolve('/service-provider/services'),
				cta: services.complete ? 'Edit services' : 'Add services'
			}
		];
	});

	// Three equal steps, a third each (the API counts steps, not documents).
	const percent = $derived(
		onboarding
			? Math.round((onboarding.progress.completed / Math.max(onboarding.progress.total, 1)) * 100)
			: 0
	);
	const allStepsDone = $derived(cards.length > 0 && cards.every((card) => card.complete));
</script>

<svelte:head>
	<title>Home · Poppynz</title>
</svelte:head>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if onboarding}
	<div class="mx-auto max-w-4xl">
		<h1 class="text-2xl font-bold text-base-content lg:text-[28px]">
			Welcome to Poppynz{firstName ? `, ${firstName}` : ''} 👋
		</h1>
		<p class="mt-1.5 text-sm text-base-content-muted">
			Let's get your profile ready for families. You can save your progress anytime.
		</p>

		<div class="mt-7 rounded-lg border border-card-border bg-base-100 p-5 shadow-card">
			<div class="flex items-baseline justify-between gap-3">
				<span class="font-display text-base font-bold text-base-content">
					Your profile is {percent}% ready
				</span>
				<span class="text-xs font-semibold text-neutral">
					{onboarding.progress.completed} of {onboarding.progress.total} steps
				</span>
			</div>
			<progress
				class="progress mt-3 h-2 w-full progress-primary"
				value={onboarding.progress.completed}
				max={onboarding.progress.total}
				aria-label="Profile readiness"
			></progress>
			<ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
				{#each cards as card (card.key)}
					<li
						class="flex items-center gap-1.5 text-xs font-semibold
							{card.complete ? 'text-success' : 'text-base-content-muted'}"
					>
						<i
							class="las {card.complete ? 'la-check-circle' : 'la-circle'} text-base"
							aria-hidden="true"
						></i>
						{card.short}
						<span class="sr-only">{card.complete ? '— done' : '— to do'}</span>
					</li>
				{/each}
			</ul>
		</div>

		<ol class="mt-6 grid gap-4 md:grid-cols-3">
			{#each cards as card, index (card.key)}
				<li
					class="flex flex-col rounded-lg border bg-base-100 p-6 shadow-card
						{card.complete ? 'border-success-content' : 'border-card-border'}"
				>
					<div class="mb-4 flex items-center justify-between">
						{#if card.complete}
							<span class="flex size-10 items-center justify-center rounded-full bg-success">
								<i class="las la-check text-lg text-success-content" aria-hidden="true"></i>
							</span>
							<span class="text-xs font-semibold text-success">Done</span>
						{:else}
							<span class="flex size-10 items-center justify-center rounded-lg {card.tint}">
								<i class="las {card.icon} text-xl" aria-hidden="true"></i>
							</span>
							<span class="text-xs font-semibold text-outline">Step {index + 1}</span>
						{/if}
					</div>
					<h2 class="font-display text-lg leading-snug font-bold text-base-content">
						{card.title}
					</h2>
					<p class="mt-1.5 text-sm leading-relaxed text-base-content-muted">{card.body}</p>
					{#if card.detail}
						<p class="mt-2 text-xs font-medium text-neutral">{card.detail}</p>
					{/if}
					<a href={card.href} class="mt-auto pt-5 text-sm font-semibold text-neutral">
						{card.cta} →
					</a>
				</li>
			{/each}
		</ol>

		<!-- Submit lives in a quiet footer until the essentials are done. -->
		<div
			class="mt-6 flex flex-wrap items-center gap-4 rounded-lg border border-card-border
				bg-base-300 px-6 py-5"
		>
			<div class="min-w-0 flex-1">
				{#if approved}
					<div class="font-display text-base font-bold text-base-content">You're approved</div>
					<p class="mt-0.5 text-sm text-base-content-muted">Families can now find you.</p>
				{:else if requestStatus === 'submitted'}
					<div class="font-display text-base font-bold text-base-content">Under review</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						Your profile is with the Poppynz team — usually ~2 days. We'll email you.
					</p>
				{:else if requestStatus === 'rejected'}
					<div class="font-display text-base font-bold text-base-content">Fix & resubmit</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						Your last application wasn't approved — check the reason, fix it, and resubmit.
					</p>
				{:else}
					<div class="font-display text-base font-bold text-base-content">Ready when you are</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						{allStepsDone
							? 'Everything is in. Submit your profile for the Poppynz team to review.'
							: "You can submit your profile before everything is complete. We'll let you know if anything else is needed before approval."}
					</p>
				{/if}
			</div>
			{#if approved || requestStatus === 'submitted'}
				<a href={resolve('/service-provider/verification')} class="btn btn-outline btn-secondary">
					{approved ? 'View verification' : 'View status'}
				</a>
			{:else}
				<button
					type="button"
					class="btn {allStepsDone ? 'btn-primary' : 'btn-outline btn-secondary'}"
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

		<p class="mt-5 flex items-center gap-2 text-xs text-outline">
			<i class="las la-pen text-base" aria-hidden="true"></i>
			Nothing is set in stone. You can update your profile, services and rates anytime.
		</p>
	</div>
{/if}
