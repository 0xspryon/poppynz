<script lang="ts">
	/** Shared documents checklist for both applicant roles. The API decides
	 * which types a role owes (`appliesToRole`) and which one is the safety
	 * gate; this page only differs in where it loads the checklist from and
	 * where its links point. */
	import { onMount } from 'svelte';
	import {
		getFamilyOnboardingState,
		getOnboardingState,
		type OnboardingDocument,
		type OnboardingState
	} from '$lib/api/onboarding';
	import { getSafetyVerification } from '$lib/api/safety-verification';
	import { resolve } from '$app/paths';
	import DocumentChecklist from '$lib/components/verification/DocumentChecklist.svelte';
	import { notifications } from '$lib/notifications.svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	const verificationHref = $derived(
		role === 'family' ? resolve('/family/verification') : resolve('/service-provider/verification')
	);
	const approvalHref = $derived(
		role === 'family' ? resolve('/family/approval') : resolve('/service-provider/verification')
	);

	let documents = $state<Array<OnboardingDocument> | null>(null);
	/** Where the applicant stands with approval — decides the call to action
	 * once every required document is in. */
	let approvalHub = $state<Pick<OnboardingState, 'approval' | 'latestApprovalRequest'> | null>(
		null
	);
	let loading = $state(true);
	let errorMessage = $state('');
	/** documentTypeIds sitting in the unpaid Credibled list. */
	let queuedTypeIds = $state<Array<string>>([]);

	async function loadBasket() {
		const result = await getSafetyVerification();
		queuedTypeIds = result.ok ? result.data.basket.map((entry) => entry.documentTypeId) : [];
	}

	async function load() {
		loading = documents === null;
		errorMessage = '';
		// Both endpoints build the checklist with the same code, so the entries
		// are the same shape whichever role is asking.
		const result =
			role === 'family' ? await getFamilyOnboardingState() : await getOnboardingState();
		if (result.ok) {
			documents = result.data.documents;
			approvalHub = {
				approval: result.data.approval,
				latestApprovalRequest: result.data.latestApprovalRequest
			};
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	// The server drops the matching Credibled item on upload, so the check list
	// is refreshed alongside the checklist.
	async function reload() {
		await Promise.all([load(), loadBasket()]);
	}

	// onMount, not $effect: load() reads `documents` synchronously, so an
	// effect would track it and re-run on every response — an infinite
	// request loop against /me/onboarding.
	onMount(() => {
		void reload();
		// The safety-gate row reads the verification's status, and a placed
		// order empties the basket — both change without the applicant acting.
		return notifications.on('safety_verification.updated', () => void reload());
	});

	const requiredDocs = $derived(documents?.filter((doc) => !doc.isOptional) ?? []);
	const allRequiredIn = $derived(
		requiredDocs.length > 0 && requiredDocs.every((doc) => doc.status !== 'missing')
	);
	// Invite the applicant onward the moment the last required document lands:
	// nothing until then, nothing once they're approved or already in review.
	const approvalCta = $derived.by((): 'submit' | 'pending' | null => {
		if (!allRequiredIn || !approvalHub || approvalHub.approval) return null;
		return approvalHub.latestApprovalRequest?.status === 'submitted' ? 'pending' : 'submit';
	});
</script>

<svelte:head>
	<title>Documents · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Documents</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{role === 'family'
			? 'Every Poppynz family completes a safety check before booking. Upload the documents below to get started.'
			: 'Upload documents yourself, or let Credibled collect the official ones for you.'}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if documents}
		<DocumentChecklist
			{documents}
			{queuedTypeIds}
			onchanged={reload}
			checkListHref={verificationHref}
		/>

		{#if approvalCta === 'submit'}
			<div
				class="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-success-content
					bg-base-100 px-5 py-4"
			>
				<span
					class="flex size-11 shrink-0 items-center justify-center rounded-full bg-success-content"
				>
					<i class="las la-user-shield text-xl text-success" aria-hidden="true"></i>
				</span>
				<div class="min-w-0 flex-1">
					<div class="font-display text-[15px] font-bold text-base-content">
						All required documents are in
					</div>
					<p class="mt-0.5 text-[13px] text-base-content-muted">
						Submit your profile for approval — a Poppynz admin usually reviews within ~2 days.
					</p>
				</div>
				<a href={approvalHref} class="btn btn-primary btn-sm">Submit for approval</a>
			</div>
		{:else if approvalCta === 'pending'}
			<p class="mt-4 text-[13px] text-base-content-muted">
				Your profile is with our review team.
				<a href={approvalHref} class="link link-primary">Check your approval status</a>
			</p>
		{/if}
	{/if}
</div>
