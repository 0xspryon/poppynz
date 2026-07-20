<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import BrandMark from '$lib/components/BrandMark.svelte';

	interface Props {
		/** Admin's display email — shown in the pinned user card. */
		email: string;
	}

	let { email }: Props = $props();

	const initial = $derived(email.charAt(0).toUpperCase() || 'A');

	const items = [
		{ href: resolve('/admin/document-types'), label: 'Document types', icon: 'la-file-alt' },
		{ href: resolve('/admin/service-catalogue'), label: 'Service catalogue', icon: 'la-heart' }
	];
</script>

<aside class="hidden w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex">
	<div class="px-2.5 pb-2">
		<BrandMark tone="dark" />
	</div>
	<div class="px-2.5 pb-4 text-[10px] font-semibold tracking-[0.14em] text-primary-soft uppercase">
		Admin console
	</div>

	{#each items as item (item.href)}
		{@const active = page.url.pathname.startsWith(item.href)}
		<a
			href={item.href}
			class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors
				{active
				? 'bg-primary/20 text-secondary-content'
				: 'text-secondary-content-muted hover:bg-primary/10 hover:text-secondary-content'}"
			aria-current={active ? 'page' : undefined}
		>
			<i class="las {item.icon} text-lg" aria-hidden="true"></i>
			{item.label}
		</a>
	{/each}

	<div class="mt-auto flex items-center gap-2.5 rounded-lg bg-secondary-content/10 p-2.5">
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm
				font-bold text-primary-content"
		>
			{initial}
		</span>
		<div class="min-w-0 leading-tight">
			<div class="truncate text-xs font-semibold text-secondary-content">{email}</div>
			<div class="text-[11px] text-secondary-content-faint">Administrator</div>
		</div>
	</div>
</aside>
