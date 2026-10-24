<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { syncLocaleWithProfile } from '$lib/locale-sync';
	import { fetchSession, getSession, type MockSession } from '$lib/api/profile';
	import { landingPathFor } from '$lib/role-landing';
	import { getOnboardingState } from '$lib/api/onboarding';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import ImpersonationBanner from '$lib/components/ImpersonationBanner.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import RealtimeNotifications from '$lib/components/RealtimeNotifications.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import TcGate from '$lib/components/TcGate.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import { payoutsBadge } from '$lib/payouts-badge.svelte';
	import { unread } from '$lib/unread.svelte';
	import { m } from '$lib/paraglide/messages';
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
				void syncLocaleWithProfile();
			} else {
				void goto(resolve(landingPathFor(fresh?.role) ?? '/auth/sign-in'));
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
		if (authorized) {
			void refreshBadge();
			void payoutsBadge.refresh();
		}
	});
	afterNavigate(() => {
		if (authorized) {
			void refreshBadge();
			void unread.refresh();
			void contractsBadge.refresh();
			void payoutsBadge.refresh();
		}
	});

	const email = $derived(session?.email ?? m.nav_email_fallback_provider());
	const impersonated = $derived(session?.impersonatedBy != null);
	const initial = $derived(email.charAt(0).toUpperCase());

	// Grouped so a brand-new helper sees the onboarding pages first; Documents,
	// Safety verification and Approval live together under Verification.
	const groupGetStarted = m.nav_group_get_started();
	const groupYourPoppynz = m.nav_group_your_poppynz();
	const groupMore = m.nav_group_more();
	const items: Array<SidebarItem> = $derived([
		{
			href: resolve('/service-provider/dashboard'),
			label: m.nav_home(),
			icon: 'la-home',
			group: groupGetStarted
		},
		{
			href: resolve('/service-provider/profile'),
			label: m.nav_profile(),
			icon: 'la-user',
			group: groupGetStarted
		},
		{
			href: resolve('/service-provider/services'),
			label: m.nav_services_rates(),
			icon: 'la-heart',
			group: groupGetStarted
		},
		{
			href: resolve('/service-provider/verification'),
			label: m.nav_verification(),
			icon: 'la-shield-alt',
			badge: missingDocuments,
			group: groupGetStarted
		},
		{
			href: resolve('/service-provider/find'),
			label: m.nav_find_families(),
			icon: 'la-search',
			group: groupYourPoppynz
		},
		{
			href: resolve('/service-provider/messages'),
			label: m.nav_messages(),
			icon: 'la-comment',
			badge: unread.count,
			group: groupYourPoppynz
		},
		{
			href: resolve('/service-provider/contracts'),
			label: m.nav_contracts(),
			icon: 'la-file-signature',
			badge: contractsBadge.count,
			group: groupYourPoppynz
		},
		{
			href: resolve('/service-provider/payouts'),
			label: m.nav_payouts(),
			icon: 'la-wallet',
			badge: payoutsBadge.needsSetup ? '!' : undefined,
			group: groupYourPoppynz
		},
		{
			href: resolve('/service-provider/referrals'),
			label: m.nav_referrals(),
			icon: 'la-user-plus',
			group: groupMore
		},
		{
			href: resolve('/service-provider/vouches'),
			label: m.nav_vouch_requests(),
			icon: 'la-handshake',
			group: groupMore
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
			<SidebarNav
				kicker={m.nav_role_helper()}
				{items}
				{email}
				roleLabel={m.nav_role_helper()}
				{impersonated}
			/>
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
					aria-label={m.nav_open()}
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
		kicker={m.nav_role_helper()}
		{items}
		{email}
		roleLabel={m.nav_role_helper()}
		{impersonated}
	/>

	<TcGate />
	<RealtimeNotifications role="service-provider" />
{/if}

<ToastHost />
