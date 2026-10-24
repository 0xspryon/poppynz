<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	/** Revoke confirm: immediate loss of verified status, reason required and
	 * shown to the applicant verbatim. Emits the trimmed reason. */
	interface Props {
		open: boolean;
		applicantName: string;
		busy?: boolean;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let { open, applicantName, busy = false, onconfirm, oncancel }: Props = $props();

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
	<div class="modal modal-open" role="dialog" aria-label={m.admin_requests_revoke_aria()}>
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">{m.admin_requests_revoke_title({ name: applicantName })}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.admin_requests_revoke_body_before()}
				<b>{m.admin_requests_revoke_body_strong()}</b>{m.admin_requests_revoke_body_after()}
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.admin_requests_reason_required()}</legend>
				<textarea
					class="textarea min-h-24 w-full"
					maxlength="500"
					bind:value={reason}
					placeholder={m.admin_requests_revoke_placeholder()}
				></textarea>
				<div class="flex justify-between text-xs text-outline">
					<span>{m.admin_requests_revoke_hint()}</span>
					<span>{reason.length} / 500</span>
				</div>
			</fieldset>

			<div
				class="mt-3 flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
					px-3.5 py-2.5"
			>
				<i class="las la-info-circle text-base text-info" aria-hidden="true"></i>
				<span class="text-[12.5px] text-info">
					{m.admin_requests_revoke_info()}
				</span>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button
					type="submit"
					class="btn btn-error text-error-content"
					disabled={reason.trim().length === 0 || busy}
				>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{m.admin_requests_revoke_submit()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
