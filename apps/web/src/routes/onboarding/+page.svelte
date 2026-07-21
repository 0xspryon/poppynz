<script lang="ts">
	// Magic-link landing for returning users (the API's callbackURL) — route
	// by role once the session cookie is readable.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession } from '$lib/api/profile';

	onMount(async () => {
		const session = await fetchSession();
		if (session?.role === 'service-provider') {
			await goto(resolve('/service-provider/dashboard'), { replaceState: true });
		} else if (session?.role === 'admin') {
			await goto(resolve('/admin'), { replaceState: true });
		} else {
			await goto(resolve('/'), { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>Poppynz</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200">
	<span class="loading loading-spinner loading-lg text-primary"></span>
</div>
