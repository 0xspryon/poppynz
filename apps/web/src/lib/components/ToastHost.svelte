<script lang="ts">
	/** Renders the global toast stack (see $lib/toast.svelte.ts). Mounted once
	 * per authenticated layout, top-right, above open modals. */
	import { fly } from 'svelte/transition';
	import { toast, type ToastKind } from '$lib/toast.svelte';

	const ALERT_CLASS: Record<ToastKind, string> = {
		success: 'alert-success',
		error: 'alert-error',
		info: 'alert-info'
	};

	const ICON_CLASS: Record<ToastKind, string> = {
		success: 'la-check-circle',
		error: 'la-exclamation-circle',
		info: 'la-info-circle'
	};
</script>

<div class="toast toast-top toast-end z-[10000] pointer-events-none" aria-live="polite">
	{#each toast.items as item (item.id)}
		<div
			role={item.kind === 'error' ? 'alert' : 'status'}
			class="alert {ALERT_CLASS[item.kind]} pointer-events-auto grid-flow-col items-start
				whitespace-normal shadow-card"
			transition:fly={{ x: 24, duration: 200 }}
		>
			<i class="las {ICON_CLASS[item.kind]} mt-0.5 text-lg" aria-hidden="true"></i>
			<div class="max-w-72 text-left">
				{#if item.title}
					<p class="text-sm font-bold">{item.title}</p>
				{/if}
				<p class="text-sm">{item.message}</p>
			</div>
			<button
				type="button"
				class="btn btn-circle btn-ghost btn-xs -mr-1"
				aria-label="Dismiss notification"
				onclick={() => toast.dismiss(item.id)}
			>
				<i class="las la-times" aria-hidden="true"></i>
			</button>
		</div>
	{/each}
</div>
