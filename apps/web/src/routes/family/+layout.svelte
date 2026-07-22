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
			if (session?.role === 'family') {
				authorized = true;
			} else if (session?.role === 'admin') {
				void goto(resolve('/admin'));
			} else if (session?.role === 'service-provider') {
				void goto(resolve('/service-provider/dashboard'));
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? 'family');
	const initial = $derived(email.charAt(0).toUpperCase());

	const items: Array<SidebarItem> = [
		{ href: resolve('/family/profile'), label: 'Profile', icon: 'la-user' }
	];
</script>

{#if authorized}
	<div class="flex min-h-screen bg-base-200">
		<aside class="hidden w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex">
			<SidebarNav kicker="Family" {items} {email} roleLabel="Family" />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Mobile header: no bottom tabs; the avatar opens the nav drawer. -->
			<header
				class="flex items-center justify-between border-b border-card-border bg-base-100 px-gutter
					py-3 lg:hidden"
			>
				<BrandMark />
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-full bg-secondary text-sm
						font-bold text-secondary-content"
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
		kicker="Family"
		{items}
		{email}
		roleLabel="Family"
	/>
{/if}
