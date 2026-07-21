<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';
	import { getOnboardingState } from '$lib/api/onboarding';
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
	let missingDocuments = $state(0);

	$effect(() => {
		if (!browser) return;
		void fetchSession().then((session) => {
			if (session?.role === 'service-provider') {
				authorized = true;
			} else if (session?.role === 'admin') {
				void goto(resolve('/admin'));
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	// The pink Documents badge mirrors the current onboarding warnings; refresh
	// it whenever the provider moves between pages (e.g. right after an upload).
	async function refreshBadge() {
		const result = await getOnboardingState();
		if (result.ok) {
			missingDocuments = result.data.warnings.missingRequiredDocuments.length;
		}
	}

	$effect(() => {
		if (authorized) void refreshBadge();
	});
	afterNavigate(() => {
		if (authorized) void refreshBadge();
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? 'provider');
	const initial = $derived(email.charAt(0).toUpperCase());

	const items: Array<SidebarItem> = $derived([
		{ href: resolve('/service-provider/dashboard'), label: 'Dashboard', icon: 'la-th-large' },
		{ href: resolve('/service-provider/profile'), label: 'Profile', icon: 'la-user' },
		{
			href: resolve('/service-provider/documents'),
			label: 'Documents',
			icon: 'la-file-alt',
			badge: missingDocuments
		},
		{ href: resolve('/service-provider/services'), label: 'Services & rates', icon: 'la-heart' },
		{ href: resolve('/service-provider/approval'), label: 'Approval', icon: 'la-user-shield' }
	]);
</script>

{#if authorized}
	<div class="flex min-h-screen bg-base-200">
		<aside class="hidden w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex">
			<SidebarNav kicker="Mom Helper" {items} {email} roleLabel="Mom Helper" />
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
		kicker="Mom Helper"
		{items}
		{email}
		roleLabel="Mom Helper"
	/>
{/if}
