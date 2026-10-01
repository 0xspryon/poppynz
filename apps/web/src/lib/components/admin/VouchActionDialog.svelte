<script lang="ts">
	/** Flag or revoke a vouch. The reason is for the admin team only — the
	 * applicant sees "Not counted", never this text. */
	interface Props {
		action: 'flag' | 'revoke' | null;
		voucherName: string;
		busy?: boolean;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let { action, voucherName, busy = false, onconfirm, oncancel }: Props = $props();

	let reason = $state('');

	$effect(() => {
		if (action) reason = '';
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (reason.trim().length === 0 || busy) return;
		onconfirm(reason.trim());
	}
</script>

{#if action}
	<div class="modal modal-open" role="dialog" aria-label="{action} vouch">
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">
				{action === 'flag' ? 'Flag' : 'Revoke'} {voucherName}'s vouch
			</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				The vouch stops counting. The applicant only sees "Not counted" — this reason stays internal.
			</p>
			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason · required</legend>
				<textarea class="textarea min-h-20 w-full" maxlength="500" bind:value={reason}></textarea>
			</fieldset>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>Cancel</button>
				<button
					type="submit"
					class="btn btn-error text-error-content"
					disabled={reason.trim().length === 0 || busy}
				>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{action === 'flag' ? 'Flag vouch' : 'Revoke vouch'}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
