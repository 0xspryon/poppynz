<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import LangToggle from '$lib/components/LangToggle.svelte';
	import type { AuthPanel } from '$lib/auth-panel';

	let { children } = $props();

	const panel = $derived(page.data.panel as AuthPanel);
</script>

<div class="flex min-h-screen flex-col lg:flex-row">
	<!-- Brand panel (desktop) -->
	<aside
		class="hidden w-brand-panel flex-none flex-col bg-secondary p-gutter-lg text-secondary-content lg:flex"
	>
		<BrandMark tone="dark" />
		<div class="my-auto py-12">
			{#if panel.eyebrow}
				<p class="mb-4 text-xs font-semibold tracking-widest text-primary-soft uppercase">
					—— {panel.eyebrow}
				</p>
			{/if}
			<h1
				class="font-display text-5xl leading-[1.1] font-bold tracking-tight text-secondary-content"
			>
				{#each panel.headline as line, i (i)}
					{#if i > 0}<br />{/if}
					{#each line as segment, j (j)}
						<span class={segment.accent ? 'text-primary' : ''}>{segment.text}</span>
					{/each}
				{/each}
			</h1>
			{#if panel.body}
				<p class="mt-6 max-w-md text-base leading-relaxed text-secondary-content-muted">
					{panel.body}
				</p>
			{/if}
			{#if panel.testimonial}
				<hr class="my-10 border-secondary-content/15" />
				<blockquote class="max-w-md">
					<p class="font-display text-xl leading-normal font-medium text-base-300 italic">
						{panel.testimonial.quote}
					</p>
					<footer class="mt-4 flex items-center gap-3">
						<span
							class="flex size-9 items-center justify-center rounded-pill bg-primary text-sm
								font-bold text-primary-content"
						>
							{panel.testimonial.initial}
						</span>
						<span class="text-sm text-secondary-content-muted">{panel.testimonial.attribution}</span
						>
					</footer>
				</blockquote>
			{/if}
		</div>
		{#if panel.trustLine}
			<p class="flex items-center gap-2 text-sm text-secondary-content-faint">
				<i class="las la-shield-alt text-base" aria-hidden="true"></i>
				{panel.trustLine}
			</p>
		{/if}
	</aside>

	<!-- Form panel -->
	<div class="flex flex-1 flex-col px-gutter pb-12 lg:px-gutter-lg lg:pt-9">
		<!-- Mobile header -->
		<div class="lg:hidden">
			{#if panel.mobileHero}
				<div class="-mx-2 mt-3 rounded-lg bg-secondary p-5">
					<div class="mb-4 flex items-center justify-between">
						<BrandMark tone="dark" />
						<LangToggle tone="dark" />
					</div>
					<p
						class="font-display text-2xl leading-tight font-bold tracking-tight text-secondary-content"
					>
						{#each panel.headline as line, i (i)}
							{#if i > 0}<br />{/if}
							{#each line as segment, j (j)}<span class={segment.accent ? 'text-primary' : ''}
									>{segment.text}</span
								>{/each}
						{/each}
					</p>
				</div>
			{:else}
				<div class="flex items-center justify-between pt-5">
					<BrandMark />
					<LangToggle />
				</div>
			{/if}
		</div>

		<!-- Desktop header -->
		<div class="hidden items-center justify-end gap-3.5 lg:flex">
			{#if panel.aux}
				<span class="text-sm text-base-content-muted">{panel.aux.text}</span>
				<a href={resolve(panel.aux.href)} class="btn btn-sm btn-outline btn-secondary">
					{panel.aux.cta}
				</a>
			{/if}
			<LangToggle />
		</div>

		<div class="flex flex-1 flex-col pt-8 lg:pt-10">
			{@render children()}
		</div>

		<!-- Mobile aux action -->
		{#if panel.aux}
			<p class="pt-6 text-center text-sm text-base-content-muted lg:hidden">
				{panel.aux.text}
				<a href={resolve(panel.aux.href)} class="font-semibold text-primary">{panel.aux.cta}</a>
			</p>
		{/if}
	</div>
</div>
