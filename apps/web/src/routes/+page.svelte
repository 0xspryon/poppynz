<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';

	// Until there's a public landing page the root only routes: signed-in
	// admins (e.g. arriving from a magic-link callback) go to the admin area,
	// everyone else enters the auth flow.
	onMount(async () => {
		const session = getSession() ?? (await fetchSession());
		if (session?.role === 'admin') {
			await goto(resolve('/admin'), { replaceState: true });
		} else {
			await goto(resolve('/auth/sign-up'), { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>Poppynz</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-base-200">
	<span class="loading loading-spinner loading-lg text-primary"></span>
</div>
