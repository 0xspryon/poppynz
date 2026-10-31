<script lang="ts">
	/** Fullscreen PII-safe document viewer frame (design 8b): the file is shown
	 * in-browser only, beside a sidebar the caller fills. Shows a loading modal
	 * while the caller fetches the signed URL. Shared by the approval-request
	 * and safety-verification reviews so both look the same. */
	import type { Snippet } from 'svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** The signed URL of the file; null closes the frame. */
		url: string | null;
		title: string;
		filename: string;
		status?: { status: ChipStatus; label?: string };
		loading?: boolean;
		onclose: () => void;
		sidebar: Snippet;
	}

	let { url, title, filename, status, loading = false, onclose, sidebar }: Props = $props();

	const isPdf = $derived(filename.toLowerCase().endsWith('.pdf'));
</script>

{#if loading}
	<div class="modal modal-open">
		<div class="modal-box flex w-40 items-center justify-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	</div>
{:else if url}
	<div
		class="fixed inset-0 z-50 flex flex-col bg-secondary"
		role="dialog"
		aria-label={m.admin_requests_viewer_aria()}
	>
		<header
			class="flex items-center justify-between gap-3 border-b border-secondary-content/10 px-5 py-3"
		>
			<div class="flex min-w-0 items-center gap-3">
				<span class="truncate font-display text-base font-bold text-secondary-content">
					{title}
				</span>
				<span class="hidden truncate text-xs text-secondary-content-faint sm:inline">
					{filename}
				</span>
				{#if status}
					<StatusChip {...status} />
				{/if}
			</div>
			<button
				type="button"
				class="flex size-9 shrink-0 items-center justify-center rounded-full
					bg-secondary-content/10 text-secondary-content-muted transition-colors
					hover:text-secondary-content"
				aria-label={m.admin_requests_viewer_close()}
				onclick={onclose}
			>
				<i class="las la-times text-lg" aria-hidden="true"></i>
			</button>
		</header>
		<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
			<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
				{#if isPdf}
					<iframe
						src={url}
						title={m.admin_requests_viewer_preview()}
						class="h-full w-full rounded-md bg-base-100"
					></iframe>
				{:else}
					<img
						src={url}
						alt={m.admin_requests_viewer_preview()}
						class="max-h-full max-w-full rounded-md shadow-panel"
					/>
				{/if}
			</div>
			<aside
				class="w-full shrink-0 overflow-y-auto border-t border-secondary-content/10 bg-base-100
					p-5 lg:w-80 lg:border-t-0 lg:border-l lg:border-card-border"
			>
				{@render sidebar()}

				<div
					class="mt-6 flex items-start gap-2.5 rounded-[9px] border border-info-content
						bg-base-200 p-3"
				>
					<i class="las la-shield-alt mt-0.5 text-base text-info" aria-hidden="true"></i>
					<span class="text-[11.5px] leading-relaxed text-info">
						{m.admin_requests_viewer_pii()}
					</span>
				</div>
			</aside>
		</div>
	</div>
{/if}
