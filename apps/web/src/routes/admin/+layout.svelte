<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';
	import { getTaxAccess } from '$lib/api/tax';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let authorized = $state(false);
	/** Signed in, but not as an admin (UAT #10): say so instead of showing a
	 * sign-in screen that suggests they are signed out. */
	let notAuthorized = $state<'family' | 'service-provider' | null>(null);
	let drawerOpen = $state(false);
	/** The accountant area is shown by permission (tax read), not by role. */
	let taxAccess = $state(false);

	onMount(() => {
		void fetchSession().then((session) => {
			if (session?.role === 'admin') {
				authorized = true;
				void getTaxAccess().then((result) => {
					taxAccess = result.ok && (result.data.canRead || result.data.canReport);
				});
			} else if (session?.role === 'family' || session?.role === 'service-provider') {
				notAuthorized = session.role;
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? 'admin');
	const initial = $derived(email.charAt(0).toUpperCase());

	const baseItems: Array<SidebarItem> = [
		{ href: resolve('/admin/approval-requests'), label: 'Approval queue', icon: 'la-user-check' },
		{
			href: resolve('/admin/safety-verifications'),
			label: 'Safety verifications',
			icon: 'la-shield-alt'
		},
		{ href: resolve('/admin/users'), label: 'Users', icon: 'la-users' },
		{ href: resolve('/admin/user-searches'), label: 'User searches', icon: 'la-search' },
		{ href: resolve('/admin/document-types'), label: 'Document types', icon: 'la-file-alt' },
		{ href: resolve('/admin/service-catalogue'), label: 'Service catalogue', icon: 'la-heart' },
		{ href: resolve('/admin/custom-services'), label: 'Custom services', icon: 'la-clipboard-check' },
		{ href: resolve('/admin/tcs'), label: 'Terms & conditions', icon: 'la-file-contract' }
	];
	const items = $derived<Array<SidebarItem>>(
		taxAccess
			? [...baseItems, { href: resolve('/accountant'), label: 'Accountant', icon: 'la-calculator' }]
			: baseItems
	);
</script>

<svelte:head>
	{#if notAuthorized}<title>Not authorized · Poppynz</title>{/if}
</svelte:head>

{#if notAuthorized}
	<main class="flex min-h-screen items-center justify-center bg-base-200 p-gutter">
		<div class="max-w-md rounded-xl border border-card-border bg-base-100 p-8 text-center">
			<i class="las la-lock text-4xl text-outline" aria-hidden="true"></i>
			<h1 class="mt-2 font-display text-xl font-bold text-base-content">Not authorized</h1>
			<p class="mt-2 text-sm text-base-content-muted">
				The admin console is for Poppynz administrators. You're signed in with a
				{notAuthorized === 'family' ? 'family' : 'helper'} account.
			</p>
			<a
				class="btn mt-5 btn-primary"
				href={notAuthorized === 'family'
					? resolve('/family/find')
					: resolve('/service-provider/dashboard')}
			>
				Back to your account
			</a>
		</div>
	</main>
{:else if authorized}
	<div class="flex min-h-screen bg-base-200">
		<!-- Sticky, viewport-tall column: the page scrolls on its own while the
			 sidebar (and its sign-out block) stays in view. -->
		<aside
			class="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex"
		>
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

<ToastHost />
