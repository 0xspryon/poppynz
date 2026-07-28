<script lang="ts">
	/** Blocking terms gate mounted in every authed layout. Fetches the user's
	 * pending T&C documents and forces acceptance, one document at a time —
	 * both for a first sign-in and after the admin publishes a new version.
	 *
	 * Documents surfaced elsewhere are excluded by slug: the SP fee acceptance
	 * gates the services-offered page, and the family fee acceptance waits for
	 * the booking flow. Anything else pending — including documents the admin
	 * creates later — blocks here so it can never silently go unshown. */
	import { onMount } from 'svelte';
	import { acceptTcs, listPendingTcs, type PublishedTc } from '$lib/api/tcs';
	import TcModal from './TcModal.svelte';

	const SURFACED_ELSEWHERE = new Set(['service_provider_fee_acceptance', 'family_fee_acceptance']);

	let pending = $state<Array<PublishedTc>>([]);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	const current = $derived(pending[0] ?? null);

	async function load() {
		const result = await listPendingTcs();
		if (result.ok) {
			pending = result.data.filter((tc) => !SURFACED_ELSEWHERE.has(tc.slug));
		}
	}

	onMount(() => {
		void load();
	});

	async function accept() {
		if (!current || busy) return;
		busy = true;
		errorMessage = null;
		const result = await acceptTcs([{ slug: current.slug, versionId: current.versionId }]);
		if (result.ok) {
			pending = pending.filter((tc) => tc.versionId !== current.versionId);
		} else if (result.error.code === 'TC_VERSION_STALE') {
			errorMessage = 'These terms were just updated — please review the newest version.';
			await load();
		} else {
			errorMessage = 'We could not record your acceptance. Please try again.';
		}
		busy = false;
	}
</script>

{#if current}
	<TcModal
		open
		title={current.title}
		content={current.content}
		checkboxLabel={current.checkboxLabel}
		intro={current.version > 1
			? 'Our terms have changed. Please review and accept the updated version to continue.'
			: 'Please review and accept to continue.'}
		{busy}
		error={errorMessage}
		onaccept={accept}
	/>
{/if}
