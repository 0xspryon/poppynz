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
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = m.common_error_generic();

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
				return m.provider_dashboard_submit_already();
			case 'INVALID_APPROVAL_REQUEST':
				return m.provider_dashboard_submit_invalid();
			default:
				return RETRY_MESSAGE;
		}
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		const result = await submitApprovalRequest();
		if (result.ok) {
			toast.success(m.provider_dashboard_submit_success(), {
				title: m.provider_dashboard_submit_success_title()
			});
			await load();
		} else {
			toast.error(submitErrorText(result.error), {
				title: m.provider_dashboard_submit_failed_title()
			});
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

	const PROFILE_FIELD_LABELS: Record<string, string> = {
		photo: m.provider_dashboard_field_photo(),
		firstName: m.provider_dashboard_field_first_name(),
		lastName: m.provider_dashboard_field_last_name(),
		phoneNumber: m.provider_dashboard_field_phone_number(),
		location: m.provider_dashboard_field_location(),
		shortBio: m.provider_dashboard_field_short_bio()
	};

	const cards = $derived.by((): Array<StepCard> => {
		if (!onboarding) return [];
		const { profile, documents, services } = onboarding.steps;
		return [
			{
				key: 'profile',
				short: m.provider_dashboard_profile_short(),
				icon: 'la-user-edit',
				tint: 'bg-base-400 text-neutral',
				title: m.provider_dashboard_profile_title(),
				body: m.provider_dashboard_profile_body(),
				// UAT #21: say exactly what is still missing (it was the photo).
				detail:
					!profile.complete && profile.missingFields.length > 0
						? m.provider_dashboard_still_missing({
								fields: profile.missingFields
									.map((field) => PROFILE_FIELD_LABELS[field] ?? field)
									.join(', ')
							})
						: null,
				complete: profile.complete,
				href: resolve('/service-provider/profile'),
				cta: profile.complete
					? m.provider_dashboard_profile_cta_edit()
					: m.provider_dashboard_profile_cta_complete()
			},
			{
				key: 'identity',
				short: m.provider_dashboard_identity_short(),
				icon: 'la-id-card',
				tint: 'bg-warning-content text-accent',
				title: m.provider_dashboard_identity_title(),
				body: m.provider_dashboard_identity_body(),
				detail:
					!documents.complete && documents.requiredTotal > 1
						? m.provider_dashboard_documents_progress({
								submitted: documents.requiredSubmitted,
								total: documents.requiredTotal
							})
						: null,
				complete: documents.complete,
				href: resolve('/service-provider/verification'),
				cta: documents.complete
					? m.provider_dashboard_identity_cta_view()
					: m.provider_dashboard_identity_cta_upload()
			},
			{
				key: 'services',
				short: m.provider_dashboard_services_short(),
				icon: 'la-hand-holding-heart',
				tint: 'bg-base-400 text-neutral',
				title: m.provider_dashboard_services_title(),
				body: m.provider_dashboard_services_body(),
				detail: null,
				complete: services.complete,
				href: resolve('/service-provider/services'),
				cta: services.complete
					? m.provider_dashboard_services_cta_edit()
					: m.provider_dashboard_services_cta_add()
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
	<title>{m.provider_dashboard_page_title()}</title>
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
			{firstName
				? m.provider_dashboard_welcome_name({ name: firstName })
				: m.provider_dashboard_welcome()}
		</h1>
		<p class="mt-1.5 text-sm text-base-content-muted">
			{m.provider_dashboard_intro()}
		</p>

		<div class="mt-7 rounded-lg border border-card-border bg-base-100 p-5 shadow-card">
			<div class="flex items-baseline justify-between gap-3">
				<span class="font-display text-base font-bold text-base-content">
					{m.provider_dashboard_percent_ready({ percent })}
				</span>
				<span class="text-xs font-semibold text-neutral">
					{m.provider_dashboard_steps_progress({
						completed: onboarding.progress.completed,
						total: onboarding.progress.total
					})}
				</span>
			</div>
			<progress
				class="progress mt-3 h-2 w-full progress-primary"
				value={onboarding.progress.completed}
				max={onboarding.progress.total}
				aria-label={m.provider_dashboard_readiness_aria()}
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
						<span class="sr-only"
							>{card.complete
								? m.provider_dashboard_step_done_sr()
								: m.provider_dashboard_step_todo_sr()}</span
						>
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
							<span class="text-xs font-semibold text-success"
								>{m.provider_dashboard_step_done()}</span
							>
						{:else}
							<span class="flex size-10 items-center justify-center rounded-lg {card.tint}">
								<i class="las {card.icon} text-xl" aria-hidden="true"></i>
							</span>
							<span class="text-xs font-semibold text-outline"
								>{m.provider_dashboard_step_number({ number: index + 1 })}</span
							>
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
					<div class="font-display text-base font-bold text-base-content">
						{m.provider_dashboard_approved_title()}
					</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						{m.provider_dashboard_approved_body()}
					</p>
				{:else if requestStatus === 'submitted'}
					<div class="font-display text-base font-bold text-base-content">
						{m.provider_dashboard_review_title()}
					</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						{m.provider_dashboard_review_body()}
					</p>
				{:else if requestStatus === 'rejected'}
					<div class="font-display text-base font-bold text-base-content">
						{m.provider_dashboard_rejected_title()}
					</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						{m.provider_dashboard_rejected_body()}
					</p>
				{:else}
					<div class="font-display text-base font-bold text-base-content">
						{m.provider_dashboard_ready_title()}
					</div>
					<p class="mt-0.5 text-sm text-base-content-muted">
						{allStepsDone
							? m.provider_dashboard_ready_body_complete()
							: m.provider_dashboard_ready_body_incomplete()}
					</p>
				{/if}
			</div>
			{#if approved || requestStatus === 'submitted'}
				<a href={resolve('/service-provider/verification')} class="btn btn-outline btn-secondary">
					{approved ? m.provider_dashboard_identity_cta_view() : m.provider_dashboard_view_status()}
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
					{requestStatus === 'rejected'
						? m.provider_dashboard_resubmit()
						: m.provider_dashboard_submit()}
				</button>
			{/if}
		</div>

		<p class="mt-5 flex items-center gap-2 text-xs text-outline">
			<i class="las la-pen text-base" aria-hidden="true"></i>
			{m.provider_dashboard_footer()}
		</p>
	</div>
{/if}
