<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { verifyMagicLink } from '$lib/api/auth';
	import { m } from '$lib/paraglide/messages';

	onMount(async () => {
		const token = page.url.searchParams.get('token') ?? '';
		const result = await verifyMagicLink(token);
		await goto(resolve(result.destination), { replaceState: true });
	});
</script>

<svelte:head>
	<title>{m.shell_page_title({ title: m.auth_verify_title() })}</title>
</svelte:head>

<div class="m-auto max-w-md py-24 text-center lg:py-0">
	<div
		class="mx-auto mb-6 size-14 animate-spin rounded-pill border-4 border-base-400
			border-t-primary"
		role="status"
		aria-label={m.auth_verify_title()}
	></div>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content">
		{m.auth_verify_heading()}
	</h2>
	<p class="text-sm leading-relaxed text-base-content-muted">
		{m.auth_verify_body()}
	</p>
</div>
