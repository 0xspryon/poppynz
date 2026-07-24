<script lang="ts">
	/** Reject dialog (design 8c): reason required, shown to the provider
	 * verbatim. Emits the trimmed reason. */
	interface Props {
		open: boolean;
		busy?: boolean;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let { open, busy = false, onconfirm, oncancel }: Props = $props();

	let reason = $state('');

	$effect(() => {
		if (open) reason = '';
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (reason.trim().length === 0 || busy) return;
		onconfirm(reason.trim());
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label="Reject application">
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">Reject this application</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				The reason is <b>shown to the provider verbatim</b> — write something specific and
				actionable so they can fix it and resubmit.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason · required</legend>
				<textarea
					class="textarea min-h-24 w-full"
					maxlength="500"
					bind:value={reason}
					placeholder="e.g. Your police clearance is older than 6 months. Please upload a recent one and resubmit."
				></textarea>
				<div class="flex justify-between text-xs text-outline">
					<span>Good reasons say what's wrong and how to fix it.</span>
					<span>{reason.length} / 500</span>
				</div>
			</fieldset>

			<div
				class="mt-3 flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
					px-3.5 py-2.5"
			>
				<i class="las la-info-circle text-base text-info" aria-hidden="true"></i>
				<span class="text-[12.5px] text-info">
					Rejection isn't final — the provider can fix the issues and submit again.
				</span>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-error text-error-content"
					disabled={reason.trim().length === 0 || busy}
				>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Reject with reason
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
