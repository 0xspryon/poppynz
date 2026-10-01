<script lang="ts">
	/** Shared approval hub for both applicant roles (screen 9d): the current
	 * standing, the submit / resubmit action, and the full history of requests
	 * and approvals. Families and helpers go through one and the same review;
	 * only where the state is loaded from and the verified label differ. */
	import { onMount } from 'svelte';
	import {
		getFamilyOnboardingState,
		getOnboardingHistory,
		getOnboardingState,
		type OnboardingHistory,
		type OnboardingState
	} from '$lib/api/onboarding';
	import ApprovalPanel from '$lib/components/verification/ApprovalPanel.svelte';
	import { notifications } from '$lib/notifications.svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	/** The slice of onboarding state this page reads — identical on both
	 * role endpoints. */
	type ApprovalHub = Pick<OnboardingState, 'approval' | 'latestApprovalRequest'>;

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let onboarding = $state<ApprovalHub | null>(null);
	let history = $state<OnboardingHistory | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	async function loadHub(): Promise<ApprovalHub | null> {
		const result =
			role === 'family' ? await getFamilyOnboardingState() : await getOnboardingState();
		return result.ok
			? { approval: result.data.approval, latestApprovalRequest: result.data.latestApprovalRequest }
			: null;
	}

	async function load() {
		errorMessage = '';
		const [hub, historyResult] = await Promise.all([loadHub(), getOnboardingHistory()]);
		if (hub && historyResult.ok) {
			onboarding = hub;
			history = historyResult.data;
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
		// An admin's decision arrives over the realtime stream; refetch so the
		// hero flips without a reload (the layout shows the toast).
		const unsubscribers = [
			notifications.on('approval.decided', () => void load()),
			notifications.on('approval.revoked', () => void load())
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	});
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
	{:else if onboarding && history}
		<ApprovalPanel {role} hub={onboarding} {history} onchanged={load} />
	{/if}
</div>
