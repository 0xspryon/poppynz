<script lang="ts">
	interface Props {
		open: boolean;
		title: string;
		body: string;
		confirmLabel?: string;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open,
		title,
		body,
		confirmLabel = 'Delete',
		busy = false,
		onconfirm,
		oncancel
	}: Props = $props();
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-box max-w-md border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">{title}</h3>
			<p class="py-3 text-sm text-base-content-muted">{body}</p>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="button" class="btn btn-error" onclick={onconfirm} disabled={busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{confirmLabel}
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label="Close"></button>
	</div>
{/if}
