<script lang="ts">
	// Magic-link landing for returning users (the API's callbackURL) — route
	// by role once the session cookie is readable.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession } from '$lib/api/profile';
	import { landingPathFor } from '$lib/role-landing';

	onMount(async () => {
		const session = await fetchSession();
		await goto(resolve(landingPathFor(session?.role) ?? '/'), { replaceState: true });
	});
</script>

<svelte:head>
	<title>Poppynz</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200">
	<span class="loading loading-spinner loading-lg text-primary"></span>
</div>
