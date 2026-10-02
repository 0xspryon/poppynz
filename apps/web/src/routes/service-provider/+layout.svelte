<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession, type MockSession } from '$lib/api/profile';
	import { getOnboardingState } from '$lib/api/onboarding';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import ImpersonationBanner from '$lib/components/ImpersonationBanner.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import RealtimeNotifications from '$lib/components/RealtimeNotifications.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import TcGate from '$lib/components/TcGate.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import { unread } from '$lib/unread.svelte';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let authorized = $state(false);
	let drawerOpen = $state(false);
	/** Measured height of the impersonation bar, so the sticky sidebar can sit
	 * just beneath it (the bar is sticky on desktop too). */
	let bannerHeight = $state(0);
	let missingDocuments = $state(0);
	let session = $state<MockSession | null>(browser ? getSession() : null);

	onMount(() => {
		void fetchSession().then((fresh) => {
			session = fresh;
			if (fresh?.role === 'service-provider') {
				authorized = true;
			} else if (fresh?.role === 'admin') {
				void goto(resolve('/admin'));
			} else if (fresh?.role === 'family') {
				void goto(resolve('/family/profile'));
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	// The pink Verification badge mirrors the current onboarding warnings; refresh
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
		if (authorized) {
			void refreshBadge();
			void unread.refresh();
			void contractsBadge.refresh();
		}
	});

	const email = $derived(session?.email ?? 'provider');
	const impersonated = $derived(session?.impersonatedBy != null);
	const initial = $derived(email.charAt(0).toUpperCase());

	// Grouped so a brand-new helper sees the onboarding pages first; Documents,
	// Safety verification and Approval live together under Verification.
	const items: Array<SidebarItem> = $derived([
		{
			href: resolve('/service-provider/dashboard'),
			label: 'Home',
			icon: 'la-home',
			group: 'Get started'
		},
		{
			href: resolve('/service-provider/profile'),
			label: 'Profile',
			icon: 'la-user',
			group: 'Get started'
		},
		{
			href: resolve('/service-provider/services'),
			label: 'Services & rates',
			icon: 'la-heart',
			group: 'Get started'
		},
		{
			href: resolve('/service-provider/verification'),
			label: 'Verification',
			icon: 'la-shield-alt',
			badge: missingDocuments,
			group: 'Get started'
		},
		{
			href: resolve('/service-provider/find'),
			label: 'Find families',
			icon: 'la-search',
			group: 'Your Poppynz'
		},
		{
			href: resolve('/service-provider/messages'),
			label: 'Messages',
			icon: 'la-comment',
			badge: unread.count,
			group: 'Your Poppynz'
		},
		{
			href: resolve('/service-provider/contracts'),
			label: 'Contracts',
			icon: 'la-file-signature',
			badge: contractsBadge.count,
			group: 'Your Poppynz'
		},
		{
			href: resolve('/service-provider/referrals'),
			label: 'Referrals',
			icon: 'la-user-plus',
			group: 'More'
		},
		{
			href: resolve('/service-provider/vouches'),
			label: 'Vouch requests',
			icon: 'la-handshake',
			group: 'More'
		}
	]);
</script>

{#if authorized}
	{#if impersonated && session}
		<div class="lg:sticky lg:top-0 lg:z-40" bind:clientHeight={bannerHeight}>
			<ImpersonationBanner {session} />
		</div>
	{/if}
	<div
		class="flex min-h-screen bg-base-200"
		style:--nav-top="{impersonated && session ? bannerHeight : 0}px"
	>
		<!-- Sticky, viewport-tall column: the page scrolls on its own while the
			 sidebar (and its sign-out block) stays in view. -->
		<aside
			class="sticky top-(--nav-top) hidden h-[calc(100dvh-var(--nav-top))] w-[250px] shrink-0
				flex-col gap-1 bg-secondary p-5 lg:flex"
		>
			<SidebarNav kicker="Mom Helper" {items} {email} roleLabel="Mom Helper" {impersonated} />
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
		{impersonated}
	/>

	<TcGate />
	<RealtimeNotifications role="service-provider" />
{/if}

<ToastHost />
