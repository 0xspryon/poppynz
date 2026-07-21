<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';
	import AdminSidebar from '$lib/components/admin/AdminSidebar.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let authorized = $state(false);

	$effect(() => {
		if (!browser) return;
		void fetchSession().then((session) => {
			if (session?.role === 'admin') {
				authorized = true;
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? 'admin');
	const initial = $derived(email.charAt(0).toUpperCase());

	const navItems = [
		{ href: resolve('/admin/document-types'), label: 'Document types' },
		{ href: resolve('/admin/service-catalogue'), label: 'Service catalogue' }
	];
</script>

{#if authorized}
	<div class="flex min-h-screen bg-base-200">
		<AdminSidebar {email} />

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Mobile header: no bottom tabs; the avatar opens the nav. -->
			<header
				class="flex items-center justify-between border-b border-card-border px-gutter py-3 lg:hidden"
			>
				<span class="flex items-center gap-2">
					<BrandMark />
					<span
						class="rounded-sm bg-secondary px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-secondary-content uppercase"
					>
						Admin
					</span>
				</span>
				<div class="dropdown dropdown-end">
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-full bg-primary text-sm
							font-bold text-primary-content"
						aria-label="Open navigation"
					>
						{initial}
					</button>
					<ul class="dropdown-content menu z-10 mt-2 w-52 rounded-box bg-base-100 p-2 shadow-card">
						{#each navItems as item (item.href)}
							<li><a href={item.href}>{item.label}</a></li>
						{/each}
					</ul>
				</div>
			</header>

			<main class="min-w-0 flex-1 p-gutter lg:px-10 lg:py-8">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
