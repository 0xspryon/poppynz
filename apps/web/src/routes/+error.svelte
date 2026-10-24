<script lang="ts">
	/** Styled error page (UAT #9): a wrong address used to show a bare,
	 * unstyled "404 Not Found" titled "web". */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { m } from '$lib/paraglide/messages';

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? m.error_not_found_title() : m.error_generic_title());
</script>

<svelte:head>
	<title>{m.shell_page_title({ title })}</title>
</svelte:head>

<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-gutter">
	<BrandMark />
	<div class="max-w-md rounded-xl border border-card-border bg-base-100 p-8 text-center">
		<p class="text-xs font-semibold tracking-widest text-outline uppercase">
			{m.error_status({ status: page.status })}
		</p>
		<h1 class="mt-1 font-display text-2xl font-bold text-base-content">{title}</h1>
		<p class="mt-2 text-sm text-base-content-muted">
			{notFound ? m.error_not_found_body() : m.error_generic_body()}
		</p>
		<a href={resolve('/')} class="btn mt-5 btn-primary">{m.error_home_link()}</a>
	</div>
</main>
