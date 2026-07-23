<script lang="ts">
	/** Revoke confirm: immediate loss of verified status, reason required and
	 * shown to the provider verbatim. Emits the trimmed reason. */
	interface Props {
		open: boolean;
		applicantName: string;
		busy?: boolean;
		error?: string;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let { open, applicantName, busy = false, error = '', onconfirm, oncancel }: Props = $props();

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
	<div class="modal modal-open" role="dialog" aria-label="Revoke approval">
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">Revoke {applicantName}'s approval</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				This takes effect immediately: the provider loses verified status and is removed from
				family search. The reason is <b>shown to the provider verbatim</b>.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason · required</legend>
				<textarea
					class="textarea min-h-24 w-full"
					maxlength="500"
					bind:value={reason}
					placeholder="e.g. Your police clearance was reported invalid. Please upload a valid one and resubmit."
				></textarea>
				<div class="flex justify-between text-xs text-outline">
					<span>Say what's wrong and how they can regain approval.</span>
					<span>{reason.length} / 500</span>
				</div>
			</fieldset>

			<div
				class="mt-3 flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
					px-3.5 py-2.5"
			>
				<i class="las la-info-circle text-base text-info" aria-hidden="true"></i>
				<span class="text-[12.5px] text-info">
					Revocation isn't a ban — the provider can fix the issue, resubmit, and be approved again.
				</span>
			</div>

			{#if error}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{error}</p>
			{/if}

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
					Revoke approval
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
