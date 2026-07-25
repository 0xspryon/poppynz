<script lang="ts" module>
	export interface SidebarItem {
		href: string;
		label: string;
		icon: string;
		/** Pink attention badge count (e.g. missing documents); hidden when falsy. */
		badge?: number;
	}
</script>

<script lang="ts">
	/** Inner column of the navy sidebar — shared by the desktop aside and the
	 * mobile drawer (design 9a: brand, role kicker, nav items with optional
	 * attention badge, language toggle + user card pinned at the bottom). */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { signOut } from '$lib/api/auth';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import LangToggle from '$lib/components/LangToggle.svelte';

	interface Props {
		/** Uppercase kicker under the brand, e.g. "Mom Helper" / "Admin console". */
		kicker: string;
		items: Array<SidebarItem>;
		email: string;
		roleLabel: string;
		/** Called after a nav item is clicked (the drawer closes itself with this). */
		onnavigate?: () => void;
		/** When set, renders a close button next to the brand (drawer variant). */
		onclose?: () => void;
		/** Pink user-card treatment while an admin impersonates this user (12d). */
		impersonated?: boolean;
	}

	let { kicker, items, email, roleLabel, onnavigate, onclose, impersonated }: Props = $props();

	const initial = $derived(email.charAt(0).toUpperCase() || '?');

	let signingOut = $state(false);

	async function handleSignOut() {
		if (signingOut) return;
		signingOut = true;
		await signOut();
		await goto(resolve('/auth/sign-in'));
	}
</script>

<div class="flex items-center justify-between px-2.5 pb-2">
	<BrandMark tone="dark" />
	{#if onclose}
		<button
			type="button"
			class="flex size-8 items-center justify-center rounded-full bg-secondary-content/10
				text-secondary-content-muted transition-colors hover:text-secondary-content"
			aria-label="Close navigation"
			onclick={onclose}
		>
			<i class="las la-times text-lg" aria-hidden="true"></i>
		</button>
	{/if}
</div>
<div class="px-2.5 pb-4 text-[10px] font-semibold tracking-[0.14em] text-primary-soft uppercase">
	{kicker}
</div>

{#each items as item (item.href)}
	{@const active = page.url.pathname.startsWith(item.href)}
	<a
		href={item.href}
		class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors
			{active
			? 'bg-primary/20 text-secondary-content'
			: 'text-secondary-content-muted hover:bg-primary/10 hover:text-secondary-content'}"
		aria-current={active ? 'page' : undefined}
		onclick={onnavigate}
	>
		<i class="las {item.icon} text-lg" aria-hidden="true"></i>
		{item.label}
		{#if item.badge}
			<span
				class="ml-auto rounded-pill bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-content"
			>
				{item.badge}
			</span>
		{/if}
	</a>
{/each}

<div class="mt-auto flex flex-col gap-3.5">
	<div class="flex justify-center">
		<LangToggle tone="dark" />
	</div>
	<div
		class="flex items-center gap-2.5 rounded-lg p-2.5
			{impersonated ? 'border border-accent/50 bg-accent/25' : 'bg-secondary-content/10'}"
	>
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold
				{impersonated ? 'bg-accent text-accent-content' : 'bg-primary text-primary-content'}"
		>
			{initial}
		</span>
		<div class="min-w-0 leading-tight">
			<div class="truncate text-xs font-semibold text-secondary-content">{email}</div>
			<div class="text-[11px] {impersonated ? 'text-warning-content' : 'text-secondary-content-faint'}">
				{impersonated ? 'via admin (impersonated)' : roleLabel}
			</div>
		</div>
	</div>
	<button
		type="button"
		class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold
			text-secondary-content-muted transition-colors hover:bg-primary/10
			hover:text-secondary-content disabled:opacity-60"
		onclick={handleSignOut}
		disabled={signingOut}
	>
		<i class="las la-sign-out-alt text-lg" aria-hidden="true"></i>
		{signingOut ? 'Signing out…' : 'Sign out'}
	</button>
</div>
