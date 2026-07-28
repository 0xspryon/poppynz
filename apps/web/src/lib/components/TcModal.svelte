<script lang="ts">
	/** Terms-and-conditions modal: scrollable document body plus, in accept
	 * mode, the version's mandatory checkbox and an Accept action. View mode
	 * (signup, previews) is read-only and dismissible. */
	import MarkdownView from './MarkdownView.svelte';

	interface Props {
		open: boolean;
		title: string;
		content: string;
		/** Accept mode only — the mandatory checkbox label of this version. */
		checkboxLabel?: string | null;
		mode?: 'accept' | 'view';
		busy?: boolean;
		error?: string | null;
		/** Optional lead-in shown above the document (e.g. "Our terms have changed"). */
		intro?: string | null;
		onaccept?: () => void;
		onclose?: () => void;
	}

	let {
		open,
		title,
		content,
		checkboxLabel = null,
		mode = 'accept',
		busy = false,
		error = null,
		intro = null,
		onaccept,
		onclose
	}: Props = $props();

	let checked = $state(false);

	$effect(() => {
		if (open) {
			// Re-tick required for every newly shown document/version.
			void content;
			checked = false;
		}
	});
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-box flex max-h-[85vh] max-w-2xl flex-col border border-card-border p-0">
			<div class="border-b border-base-300 px-6 py-4">
				<div class="flex items-center justify-between">
					<h2 class="font-display text-lg font-bold text-base-content">{title}</h2>
					{#if mode === 'view' && onclose}
						<button
							type="button"
							class="btn btn-square btn-ghost btn-sm"
							aria-label="Close"
							onclick={onclose}
						>
							<i class="las la-times text-lg" aria-hidden="true"></i>
						</button>
					{/if}
				</div>
				{#if intro}
					<p class="mt-1 text-[13px] text-base-content-muted">{intro}</p>
				{/if}
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
				<MarkdownView {content} />
			</div>
			<div class="border-t border-base-300 bg-base-200 px-6 py-4">
				{#if error}
					<p
						class="mb-3 flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content
							px-4 py-3 text-sm font-medium text-error"
						role="alert"
					>
						<i class="las la-exclamation-circle text-base" aria-hidden="true"></i>
						{error}
					</p>
				{/if}
				{#if mode === 'accept'}
					<label class="label items-start gap-2.5 text-sm whitespace-normal text-base-content">
						<input
							type="checkbox"
							class="checkbox checkbox-primary checkbox-sm"
							bind:checked
							disabled={busy}
						/>
						<span>{checkboxLabel}</span>
					</label>
					<div class="mt-4 flex justify-end gap-2.5">
						{#if onclose}
							<button type="button" class="btn btn-ghost" onclick={onclose} disabled={busy}>
								Not now
							</button>
						{/if}
						<button
							type="button"
							class="btn btn-primary"
							disabled={!checked || busy}
							onclick={onaccept}
						>
							{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
							Agree and continue
						</button>
					</div>
				{:else}
					<div class="flex justify-end">
						<button type="button" class="btn btn-primary" onclick={onclose}>Close</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
