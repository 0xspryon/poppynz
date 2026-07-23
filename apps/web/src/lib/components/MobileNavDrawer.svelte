<script lang="ts">
	/** Mobile navigation drawer (design 9a "side nav open"): tapping the avatar
	 * opens a navy panel sliding over a dimmed backdrop — replaces bottom tabs
	 * and the old dropdown menu. Desktop keeps the persistent sidebar. */
	import SidebarNav, { type SidebarItem } from '$lib/components/SidebarNav.svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
		kicker: string;
		items: Array<SidebarItem>;
		email: string;
		roleLabel: string;
		/** Pink user-card treatment while an admin impersonates this user (12d). */
		impersonated?: boolean;
	}

	let { open, onclose, kicker, items, email, roleLabel, impersonated }: Props = $props();

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<div class="fixed inset-0 z-50 lg:hidden">
		<button
			type="button"
			class="absolute inset-0 bg-base-content/45"
			aria-label="Close navigation"
			onclick={onclose}
		></button>
		<aside
			class="absolute inset-y-0 left-0 flex w-[292px] flex-col gap-1 bg-secondary p-4 shadow-panel"
			aria-label="Navigation"
		>
			<SidebarNav {kicker} {items} {email} {roleLabel} {impersonated} onnavigate={onclose} {onclose} />
		</aside>
	</div>
{/if}
