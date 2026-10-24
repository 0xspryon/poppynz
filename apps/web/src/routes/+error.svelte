<script lang="ts">
	/** Styled error page (UAT #9): a wrong address used to show a bare,
	 * unstyled "404 Not Found" titled "web". */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandMark from '$lib/components/BrandMark.svelte';

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? 'Page not found' : 'Something went wrong');
</script>

<svelte:head>
	<title>{title} · Poppynz</title>
</svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-gutter">
	<BrandMark />
	<div class="max-w-md rounded-xl border border-card-border bg-base-100 p-8 text-center">
		<p class="text-xs font-semibold tracking-widest text-outline uppercase">Error {page.status}</p>
		<h1 class="mt-1 font-display text-2xl font-bold text-base-content">{title}</h1>
		<p class="mt-2 text-sm text-base-content-muted">
			{notFound
				? "That address doesn't match any page. It may have moved, or the link may be mistyped."
				: 'We hit a problem showing this page. Please try again in a moment.'}
		</p>
		<a href={resolve('/')} class="btn mt-5 btn-primary">Go to Poppynz</a>
	</div>
</main>
