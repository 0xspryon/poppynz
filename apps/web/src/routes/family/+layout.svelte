<script lang="ts">
	import { browser } from '$app/environment';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession, type MockSession } from '$lib/api/profile';
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
	let session = $state<MockSession | null>(browser ? getSession() : null);

	onMount(() => {
		void fetchSession().then((fresh) => {
			session = fresh;
			if (fresh?.role === 'family') {
				authorized = true;
			} else if (fresh?.role === 'admin') {
				void goto(resolve('/admin'));
			} else if (fresh?.role === 'service-provider') {
				void goto(resolve('/service-provider/dashboard'));
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	afterNavigate(() => {
		if (authorized) {
			void unread.refresh();
			void contractsBadge.refresh();
		}
	});

	const email = $derived(session?.email ?? 'family');
	const impersonated = $derived(session?.impersonatedBy != null);
	const initial = $derived(email.charAt(0).toUpperCase());

	const items: Array<SidebarItem> = $derived([
		{ href: resolve('/family/find'), label: 'Find help', icon: 'la-search' },
		{
			href: resolve('/family/messages'),
			label: 'Messages',
			icon: 'la-comment',
			badge: unread.count
		},
		{
			href: resolve('/family/contracts'),
			label: 'Contracts',
			icon: 'la-file-signature',
			badge: contractsBadge.count
		},
		{ href: resolve('/family/needs'), label: 'Services I need', icon: 'la-clipboard-list' },
		{
			href: resolve('/family/verification'),
			label: 'Safety verification',
			icon: 'la-shield-alt'
		},
		{ href: resolve('/family/profile'), label: 'Profile', icon: 'la-user' },
		{ href: resolve('/family/referrals'), label: 'Referrals', icon: 'la-user-plus' }
	]);
</script>

{#if authorized}
	{#if impersonated && session}
		<ImpersonationBanner {session} />
	{/if}
	<div class="flex min-h-screen bg-base-200">
		<aside class="hidden w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex">
			<SidebarNav kicker="Family" {items} {email} roleLabel="Family" {impersonated} />
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
		{impersonated}
	/>

	<TcGate />
	<RealtimeNotifications role="family" />
{/if}

<ToastHost />
