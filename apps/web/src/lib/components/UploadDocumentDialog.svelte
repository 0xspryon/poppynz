<script lang="ts">
	/** Upload/replace dialog for a KYC document (provider documents page).
	 * Owns the file + expiry inputs; emits them on submit. Opens while
	 * `target` is set. */
	import type { OnboardingDocument } from '$lib/api/onboarding';

	const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';

	interface Props {
		target: OnboardingDocument | null;
		busy?: boolean;
		error?: string;
		onsubmit: (input: { file: File; expiryDate: string | null }) => void;
		oncancel: () => void;
	}

	let { target, busy = false, error = '', onsubmit, oncancel }: Props = $props();

	let file = $state<File | null>(null);
	let expiry = $state('');

	$effect(() => {
		if (target) {
			file = null;
			expiry = '';
		}
	});

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	const canSubmit = $derived(file !== null && (!target?.requiresExpiryDate || expiry !== ''));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!file || !canSubmit || busy) return;
		onsubmit({ file, expiryDate: expiry ? new Date(expiry).toISOString() : null });
	}
</script>

{#if target}
	<div class="modal modal-open" role="dialog" aria-label="Upload document">
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">
				{target.document ? 'Replace' : 'Upload'} — {target.name}
			</h2>
			<p class="mt-1 text-xs text-base-content-muted">
				PDF, JPG, PNG or WebP · up to 50 MB. Your file is stored securely and only visible to the
				Poppynz review team.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">File</legend>
				<input
					type="file"
					class="file-input w-full"
					accept={ACCEPTED_TYPES}
					onchange={onFileChange}
				/>
			</fieldset>

			{#if target.requiresExpiryDate}
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">Expiry date</legend>
					<input type="date" class="input w-full" bind:value={expiry} />
					<p class="label text-xs">This document type requires a future expiry date.</p>
				</fieldset>
			{/if}

			{#if error}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={!canSubmit || busy}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{target.document ? 'Replace document' : 'Submit document'}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
