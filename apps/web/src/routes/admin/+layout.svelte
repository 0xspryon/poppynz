<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { syncLocaleWithProfile } from '$lib/locale-sync';
	import { fetchSession, getSession } from '$lib/api/profile';
	import { getTaxAccess } from '$lib/api/tax';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { m } from '$lib/paraglide/messages';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	let authorized = $state(false);
	/** Signed in, but not as an admin (UAT #10): say so instead of showing a
	 * sign-in screen that suggests they are signed out. */
	let notAuthorized = $state<'family' | 'service-provider' | 'accountant' | null>(null);
	let drawerOpen = $state(false);
	/** The accountant area is shown by permission (tax read), not by role. */
	let taxAccess = $state(false);

	onMount(() => {
		void fetchSession().then((session) => {
			if (session?.role === 'admin') {
				authorized = true;
				void syncLocaleWithProfile();
				void getTaxAccess().then((result) => {
					taxAccess = result.ok && (result.data.canRead || result.data.canReport);
				});
			} else if (
				session?.role === 'family' ||
				session?.role === 'service-provider' ||
				session?.role === 'accountant'
			) {
				notAuthorized = session.role;
			} else {
				void goto(resolve('/auth/sign-in'));
			}
		});
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? m.nav_email_fallback_admin());
	const initial = $derived(email.charAt(0).toUpperCase());

	const baseItems: Array<SidebarItem> = [
		{ href: resolve('/admin/approval-requests'), label: m.nav_admin_approval_queue(), icon: 'la-user-check' },
		{
			href: resolve('/admin/safety-verifications'),
			label: m.nav_admin_safety_verifications(),
			icon: 'la-shield-alt'
		},
		{ href: resolve('/admin/users'), label: m.nav_admin_users(), icon: 'la-users' },
		{ href: resolve('/admin/user-searches'), label: m.nav_admin_user_searches(), icon: 'la-search' },
		{ href: resolve('/admin/document-types'), label: m.nav_admin_document_types(), icon: 'la-file-alt' },
		{ href: resolve('/admin/service-catalogue'), label: m.nav_admin_service_catalogue(), icon: 'la-heart' },
		{ href: resolve('/admin/custom-services'), label: m.nav_admin_custom_services(), icon: 'la-clipboard-check' },
		{ href: resolve('/admin/tcs'), label: m.nav_admin_tcs(), icon: 'la-file-contract' }
	];
	const items = $derived<Array<SidebarItem>>(
		taxAccess
			? [
					...baseItems,
					{ href: resolve('/accountant'), label: m.nav_accountant(), icon: 'la-calculator' }
				]
			: baseItems
	);
</script>

<svelte:head>
	{#if notAuthorized}<title>{m.shell_page_title({ title: m.nav_not_authorized() })}</title>{/if}
</svelte:head>

{#if notAuthorized}
	<main class="flex min-h-screen items-center justify-center bg-base-200 p-gutter">
		<div class="max-w-md rounded-xl border border-card-border bg-base-100 p-8 text-center">
			<i class="las la-lock text-4xl text-outline" aria-hidden="true"></i>
			<h1 class="mt-2 font-display text-xl font-bold text-base-content">
				{m.nav_not_authorized()}
			</h1>
			<p class="mt-2 text-sm text-base-content-muted">
				{notAuthorized === 'family'
					? m.nav_not_authorized_body_family()
					: notAuthorized === 'accountant'
						? m.nav_not_authorized_body_accountant()
						: m.nav_not_authorized_body_helper()}
			</p>
			<a
				class="btn mt-5 btn-primary"
				href={notAuthorized === 'family'
					? resolve('/family/find')
					: notAuthorized === 'accountant'
						? resolve('/accountant')
						: resolve('/service-provider/dashboard')}
			>
				{m.nav_not_authorized_back()}
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
			<SidebarNav
				kicker={m.nav_admin_console()}
				{items}
				{email}
				roleLabel={m.nav_role_administrator()}
			/>
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
						{m.nav_admin_badge()}
					</span>
				</span>
				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-full bg-primary text-sm
						font-bold text-primary-content"
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
		kicker={m.nav_admin_console()}
		{items}
		{email}
		roleLabel={m.nav_role_administrator()}
	/>
{/if}

<ToastHost />
