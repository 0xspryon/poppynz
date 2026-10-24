<script lang="ts">
	import { m } from '$lib/paraglide/messages';
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
	<div
		class="modal modal-open"
		role="dialog"
		aria-label={m.admin_users_ban_aria({ name: user.name })}
	>
		<form class="modal-box max-w-md" onsubmit={submit}>
			<h2 class="text-lg font-bold">{m.admin_users_ban_title({ name: user.name })}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.admin_users_ban_body()}
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.admin_users_ban_reason_label()}</legend>
				<input
					type="text"
					class="input w-full"
					placeholder={m.admin_users_ban_reason_placeholder()}
					bind:value={reason}
				/>
			</fieldset>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-error" disabled={busy}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{m.admin_users_ban_submit()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
