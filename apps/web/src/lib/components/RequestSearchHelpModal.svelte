<script lang="ts">
	/** No-results escape hatch: explains that submitting shares the search
	 * filters with the Poppynz team so an administrator can reach out and help
	 * the family find the right helper. */
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { open, busy = false, onconfirm, oncancel }: Props = $props();

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onconfirm();
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={m.family_assist_aria()}>
		<form class="modal-box max-w-md" onsubmit={submit}>
			<span class="flex size-11 items-center justify-center rounded-full bg-success-content">
				<i class="las la-hands-helping text-xl text-success" aria-hidden="true"></i>
			</span>
			<h2 class="mt-3 font-display text-lg font-bold text-base-content">
				{m.family_assist_title()}
			</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.family_assist_body()}
			</p>
			<p class="mt-2 text-[13px] leading-relaxed text-base-content-muted">
				{m.family_assist_body_privacy()}
			</p>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{m.family_assist_submit()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
