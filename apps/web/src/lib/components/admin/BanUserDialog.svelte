<script lang="ts">
	/** Ban confirm: signs the user out everywhere; the optional reason is
	 * admin-facing only. Opens while `user` is set. */
	interface Props {
		user: { name: string } | null;
		busy?: boolean;
		onconfirm: (reason: string | undefined) => void;
		oncancel: () => void;
	}

	let { user, busy = false, onconfirm, oncancel }: Props = $props();

	let reason = $state('');

	$effect(() => {
		if (user) reason = '';
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onconfirm(reason.trim() || undefined);
	}
</script>

{#if user}
	<div class="modal modal-open" role="dialog" aria-label="Ban {user.name}">
		<form class="modal-box max-w-md" onsubmit={submit}>
			<h2 class="text-lg font-bold">Ban {user.name}?</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				They are signed out everywhere immediately and can no longer sign in. You can unban them
				later.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason (optional)</legend>
				<input
					type="text"
					class="input w-full"
					placeholder="Shown to other admins"
					bind:value={reason}
				/>
			</fieldset>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="submit" class="btn btn-error" disabled={busy}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Ban user
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
