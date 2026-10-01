<script lang="ts">
	/** Shared safety-verification screen for both roles (families and helpers
	 * are screened identically — only the copy differs). Offers the two routes
	 * to being verified and shows where the current one stands. */
	import { onMount } from 'svelte';
	import {
		getSafetyVerification,
		type SafetyVerificationState
	} from '$lib/api/safety-verification';
	import { resolve } from '$app/paths';
	import SafetyCheckPanel from '$lib/components/verification/SafetyCheckPanel.svelte';
	import { notifications } from '$lib/notifications.svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	// NB: not named `state` — that shadows the $state rune and svelte-check
	// resolves the rune to the local binding.
	let page = $state<SafetyVerificationState | null>(null);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);

	const documentsHref = $derived(
		role === 'family' ? resolve('/family/documents') : resolve('/service-provider/verification')
	);

	async function load() {
		loading = true;
		await refresh();
		loading = false;
	}

	/** Re-reads the summary without blanking the page — the realtime event
	 * that triggers this carries only a status, so the page fetches the rest. */
	async function refresh() {
		const result = await getSafetyVerification();
		if (result.ok) {
			page = result.data;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'UNAUTHORIZED'
					? 'Your session has expired — sign in again.'
					: RETRY_MESSAGE;
		}
	}

	onMount(() => {
		void load();
		return notifications.on('safety_verification.updated', () => {
			void refresh();
		});
	});
</script>

<svelte:head>
	<title>Safety verification · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Safety verification</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{role === 'family'
			? 'Every Poppynz family completes a safety check before booking.'
			: 'Every Poppynz helper completes a safety check before taking bookings.'}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if page}
		<SafetyCheckPanel summary={page} onchanged={refresh} {documentsHref} />
	{/if}
</div>
