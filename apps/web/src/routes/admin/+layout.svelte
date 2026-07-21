<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let authorized = $state(false);
	let drawerOpen = $state(false);

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

	const items: Array<SidebarItem> = [
		{ href: resolve('/admin/approval-requests'), label: 'Approval queue', icon: 'la-user-check' },
		{ href: resolve('/admin/document-types'), label: 'Document types', icon: 'la-file-alt' },
		{ href: resolve('/admin/service-catalogue'), label: 'Service catalogue', icon: 'la-heart' }
	];
</script>

{#if authorized}
	<div class="flex min-h-screen bg-base-200">
		<aside class="hidden w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex">
			<SidebarNav kicker="Admin console" {items} {email} roleLabel="Administrator" />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Mobile header: no bottom tabs; the avatar opens the nav drawer. -->
			<header
				class="flex items-center justify-between border-b border-card-border bg-base-100 px-gutter
					py-3 lg:hidden"
			>
				<span class="flex items-center gap-2">
					<BrandMark />
					<span
						class="rounded-sm bg-secondary px-1.5 py-0.5 text-[9px] font-semibold tracking-widest
							text-secondary-content uppercase"
					>
						Admin
					</span>
				</span>
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-full bg-primary text-sm
						font-bold text-primary-content"
					aria-label="Open navigation"
					onclick={() => (drawerOpen = true)}
				>
					{initial}
				</button>
			</header>

			<main class="min-w-0 flex-1 p-gutter lg:px-10 lg:py-8">
				{@render children()}
			</main>
		</div>
	</div>

	<MobileNavDrawer
		open={drawerOpen}
		onclose={() => (drawerOpen = false)}
		kicker="Admin console"
		{items}
		{email}
		roleLabel="Administrator"
	/>
{/if}
