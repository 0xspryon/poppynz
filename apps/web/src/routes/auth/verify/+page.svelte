<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { verifyMagicLink } from '$lib/api/auth';

	onMount(async () => {
		const token = page.url.searchParams.get('token') ?? 'demo';
		const result = await verifyMagicLink(token);
		await goto(resolve(result.destination), { replaceState: true });
	});
</script>

<svelte:head>
	<title>Signing you in · Poppynz</title>
</svelte:head>

<div class="m-auto max-w-md py-24 text-center lg:py-0">
	<div
		class="mx-auto mb-6 size-14 animate-spin rounded-pill border-4 border-base-400
			border-t-primary"
		role="status"
		aria-label="Signing you in"
	></div>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content">Signing you in…</h2>
	<p class="text-sm leading-relaxed text-base-content-muted">
		This only takes a moment. You'll land on your dashboard right after.
	</p>
</div>
