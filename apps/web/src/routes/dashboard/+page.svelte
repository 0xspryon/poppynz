<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Dashboard · Poppynz</title>
</svelte:head>

<div class="flex min-h-screen flex-col px-gutter lg:px-gutter-lg">
	<header class="flex items-center justify-between py-6">
		<BrandMark />
		<span
			class="rounded-sm bg-success-content px-2.5 py-1 text-xs font-semibold text-success"
		>
			Signed in
		</span>
	</header>

	<main class="m-auto w-full max-w-form pb-24 text-center">
		<div
			class="mx-auto mb-6 flex size-20 items-center justify-center rounded-pill bg-success-content"
		>
			<i class="las la-check-circle text-4xl text-success" aria-hidden="true"></i>
		</div>
		<h1 class="mb-3 font-display text-4xl font-bold text-base-content">Welcome to your dashboard</h1>
		<p class="mb-8 leading-relaxed text-base-content-muted">
			The role-specific dashboard UI comes in a later slice. You reached this screen through the
			full mocked auth flow — magic link and all.
		</p>
		<Button variant="secondary" onclick={() => goto(resolve('/auth/sign-up'))}>
			<i class="las la-redo-alt" aria-hidden="true"></i> Restart the flow
		</Button>
	</main>
</div>
