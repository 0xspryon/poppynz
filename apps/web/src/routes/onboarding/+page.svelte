<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Onboarding · Poppynz</title>
</svelte:head>

<div class="flex min-h-screen flex-col px-gutter lg:px-gutter-lg">
	<header class="flex items-center justify-between py-6">
		<BrandMark />
		<span
			class="rounded-sm bg-info-content px-2.5 py-1 text-xs font-semibold text-info"
		>
			Onboarding
		</span>
	</header>

	<main class="m-auto w-full max-w-form pb-24 text-center">
		<div
			class="mx-auto mb-6 flex size-20 items-center justify-center rounded-pill bg-base-400"
		>
			<i class="las la-clipboard-list text-4xl text-primary" aria-hidden="true"></i>
		</div>
		<h1 class="mb-3 font-display text-4xl font-bold text-base-content">You're all set to begin</h1>
		<p class="mb-8 leading-relaxed text-base-content-muted">
			The onboarding steps (profile, verification documents, services) will live here. This
			placeholder just proves the auth flow lands new accounts in the right place.
		</p>
		<Button onclick={() => goto(resolve('/dashboard'))}>
			Skip to dashboard <i class="las la-arrow-right" aria-hidden="true"></i>
		</Button>
	</main>
</div>
