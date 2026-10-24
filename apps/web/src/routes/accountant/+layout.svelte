<script lang="ts">
	/** The accountant area: the tax configuration and its reports. Open to
	 * anyone holding the `tax` (or `taxReport`) permission — the accountant
	 * and admins alike — never decided by role. */
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { fetchSession, getSession } from '$lib/api/profile';
	import { getTaxAccess, type TaxAccess } from '$lib/api/tax';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import MobileNavDrawer from '$lib/components/MobileNavDrawer.svelte';
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
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
			} else {
				await goto(resolve('/'));
			}
		})();
	});

	const session = $derived(browser ? getSession() : null);
	const email = $derived(session?.email ?? '');
	const initial = $derived(email.charAt(0).toUpperCase());
	const isAdmin = $derived(session?.role === 'admin');

	const items = $derived<Array<SidebarItem>>([
		...(access?.canRead
			? [
					{ href: resolve('/accountant/rates'), label: 'Rates', icon: 'la-percent', group: 'Tax' },
					{
						href: resolve('/accountant/treatments'),
						label: 'Treatments',
						icon: 'la-sitemap',
						group: 'Tax'
					},
					{
						href: resolve('/accountant/registrations'),
						label: 'Registrations',
						icon: 'la-id-card',
						group: 'Tax'
					},
					{
						href: resolve('/accountant/audit'),
						label: 'Audit log',
						icon: 'la-history',
						group: 'Tax'
					}
				]
			: []),
		...(access?.canReport
			? [
					{
						href: resolve('/accountant/reports'),
						label: 'Reports',
						icon: 'la-file-invoice-dollar',
						group: 'Tax'
					}
				]
			: []),
		...(isAdmin ? [{ href: resolve('/admin'), label: 'Admin console', icon: 'la-arrow-left' }] : [])
	]);
	const roleLabel = $derived(isAdmin ? 'Administrator' : 'Accountant');
</script>

{#if access}
	<div class="flex min-h-screen bg-base-200">
		<aside
			class="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col gap-1 bg-secondary p-5 lg:flex"
		>
			<SidebarNav kicker="Accountant" {items} {email} {roleLabel} />
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
						Accountant
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
		kicker="Accountant"
		{items}
		{email}
		{roleLabel}
	/>
{/if}

<ToastHost />
