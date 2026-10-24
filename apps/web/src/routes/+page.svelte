<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession } from '$lib/api/profile';
	import { landingPathFor } from '$lib/role-landing';

	// Until there's a public landing page the root only routes: signed-in
	// users go to their own area, everyone else enters the auth flow. The
	// session is read fresh, never from the cache — the magic link lands here,
	// and a cached session from an earlier user would route to their area,
	// whose guard then turned the new role away (U1).
	onMount(async () => {
		const session = await fetchSession();
		await goto(resolve(landingPathFor(session?.role) ?? '/auth/sign-up'), { replaceState: true });
	});
</script>

<svelte:head>
	<title>Poppynz</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200">
	<span class="loading loading-spinner loading-lg text-primary"></span>
</div>
