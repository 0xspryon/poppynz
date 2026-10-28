<script lang="ts">
	/** The accountant area: the tax configuration and its reports. Open to
	 * anyone holding the `tax` (or `taxReport`) permission — the accountant
	 * and admins alike — never decided by role. */
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { syncLocaleWithProfile } from '$lib/locale-sync';
	import { fetchSession, getSession } from '$lib/api/profile';
	import { getTaxAccess, type TaxAccess } from '$lib/api/tax';
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
	let access = $state<TaxAccess | null>(null);
	let drawerOpen = $state(false);

	onMount(() => {
		void (async () => {
			const session = await fetchSession();
			if (!session) {
				await goto(resolve('/auth/sign-in'));
				return;
			}
			const result = await getTaxAccess();
			if (result.ok && (result.data.canRead || result.data.canReport)) {
				access = result.data;
				void syncLocaleWithProfile();
			} else {
				await goto(resolve('/'));
			}
		})();
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? '');
	const initial = $derived(email.charAt(0).toUpperCase());
	const isAdmin = $derived(session?.role === 'admin');

	const groupTax = m.nav_group_tax();
	const items = $derived<Array<SidebarItem>>([
		...(access?.canRead
			? [
					{
						href: resolve('/accountant/rates'),
						label: m.nav_tax_rates(),
						icon: 'la-percent',
						group: groupTax
					},
					{
						href: resolve('/accountant/treatments'),
						label: m.nav_tax_treatments(),
						icon: 'la-sitemap',
						group: groupTax
					},
					{
						href: resolve('/accountant/registrations'),
						label: m.nav_tax_registrations(),
						icon: 'la-id-card',
						group: groupTax
					},
					{
						href: resolve('/accountant/audit'),
						label: m.nav_tax_audit_log(),
						icon: 'la-history',
						group: groupTax
					}
				]
			: []),
		...(access?.canReport
			? [
					{
						href: resolve('/accountant/reports'),
						label: m.nav_tax_reports(),
						icon: 'la-file-invoice-dollar',
						group: groupTax
					}
				]
			: []),
		// Failed session refunds land with the accountant too (permission
		// `refundQueue`, held by accountants and admins).
		{ href: resolve('/accountant/refunds'), label: m.nav_admin_refunds(), icon: 'la-undo-alt' },
		// Card disputes and what Poppynz bears, read-only (permission
		// `cardDispute: read, finance`).
		{
			href: resolve('/accountant/card-disputes'),
			label: m.nav_admin_card_disputes(),
			icon: 'la-exclamation-triangle'
		},
		...(isAdmin
			? [{ href: resolve('/admin'), label: m.nav_admin_console(), icon: 'la-arrow-left' }]
			: [])
	]);
	const roleLabel = $derived(isAdmin ? m.nav_role_administrator() : m.nav_role_accountant());
</script>

{#if access}
	<div class="flex min-h-screen bg-base-200">
		<aside
			class="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex"
		>
			<SidebarNav kicker={m.nav_role_accountant()} {items} {email} {roleLabel} />
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
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
						{m.nav_role_accountant()}
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
		kicker={m.nav_role_accountant()}
		{items}
		{email}
		{roleLabel}
	/>
{/if}

<ToastHost />
