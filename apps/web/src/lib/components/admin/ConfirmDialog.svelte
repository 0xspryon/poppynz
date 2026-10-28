<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		title: string;
		body: string;
		confirmLabel?: string;
		/** The dismiss button's label ("Cancel" by default); a dialog that
		 * itself cancels something should say "Back". */
		cancelLabel?: string;
		/** btn class of the confirm action; destructive red by default. */
		confirmClass?: string;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
		/** Optional extra content under the body (e.g. a reminder with a link). */
		children?: Snippet;
	}

	let {
		open,
		title,
		body,
		confirmLabel = m.common_delete(),
		cancelLabel = m.common_cancel(),
		confirmClass = 'btn-error',
		busy = false,
		onconfirm,
		oncancel,
		children
	}: Props = $props();
</script>

{#if open}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		onkeydown={(event) => {
			if (event.key === 'Escape' && !busy) oncancel();
		}}
	>
		<!-- Focus moves into the dialog when it opens (keyboard and screen readers). -->
		<div
			class="modal-box max-w-md border border-card-border"
			tabindex="-1"
			{@attach (box) => box.focus()}
		>
			<h3 class="font-display text-xl font-bold text-base-content">{title}</h3>
			<p class="py-3 text-sm text-base-content-muted">{body}</p>
			{#if children}
				<div class="pb-1">{@render children()}</div>
			{/if}
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{cancelLabel}
				</button>
				<button type="button" class="btn {confirmClass}" onclick={onconfirm} disabled={busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{confirmLabel}
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label={m.common_close()}
		></button>
	</div>
{/if}
