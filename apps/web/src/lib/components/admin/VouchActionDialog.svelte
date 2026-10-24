<script lang="ts">
	import { m } from '$lib/paraglide/messages';
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
	<div class="modal modal-open" role="dialog" aria-label={action === 'flag'
			? m.admin_requests_vouch_action_aria_flag()
			: m.admin_requests_vouch_action_aria_revoke()}>
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">
				{action === 'flag'
					? m.admin_requests_vouch_action_title_flag({ name: voucherName })
					: m.admin_requests_vouch_action_title_revoke({ name: voucherName })}
			</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.admin_requests_vouch_action_body()}
			</p>
			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.admin_requests_reason_required()}</legend>
				<textarea class="textarea min-h-20 w-full" maxlength="500" bind:value={reason}></textarea>
			</fieldset>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}
					>{m.common_cancel()}</button
				>
				<button
					type="submit"
					class="btn btn-error text-error-content"
					disabled={reason.trim().length === 0 || busy}
				>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{action === 'flag'
						? m.admin_requests_vouch_action_submit_flag()
						: m.admin_requests_vouch_action_submit_revoke()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}></button>
	</div>
{/if}
