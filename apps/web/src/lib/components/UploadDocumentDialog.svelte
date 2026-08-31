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
		onsubmit: (input: {
			file: File;
			expiryDate: string | null;
			/** Only collected for a type that backs safety verification. */
			issuingAuthority?: string;
			documentNumber?: string;
			issuedOn?: string;
		}) => void;
		oncancel: () => void;
	}

	let { target, busy = false, error = '', onsubmit, oncancel }: Props = $props();

	let file = $state<File | null>(null);
	let expiry = $state('');
	// A vulnerable-sector check is the applicant's safety-verification
	// evidence, so it carries provenance an ordinary document does not.
	let issuingAuthority = $state('');
	let documentNumber = $state('');
	let issuedOn = $state('');

	// Writes only — never read state this effect also assigns, or Svelte loops.
	$effect(() => {
		if (target) {
			file = null;
			expiry = '';
			issuingAuthority = '';
			documentNumber = '';
			issuedOn = '';
		}
	});

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	const needsIssuingDetails = $derived(target?.backsSafetyVerification === true);

	const canSubmit = $derived(
		file !== null &&
			(!target?.requiresExpiryDate || expiry !== '') &&
			(!needsIssuingDetails ||
				(issuingAuthority.trim() !== '' && documentNumber.trim() !== '' && issuedOn !== ''))
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!file || !canSubmit || busy) return;
		onsubmit({
			file,
			expiryDate: expiry ? new Date(expiry).toISOString() : null,
			...(needsIssuingDetails
				? {
						issuingAuthority: issuingAuthority.trim(),
						documentNumber: documentNumber.trim(),
						issuedOn
					}
				: {})
		});
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

			{#if needsIssuingDetails}
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">Issuing police service</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						placeholder="Toronto Police Service"
						bind:value={issuingAuthority}
					/>
				</fieldset>
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">Document number</legend>
					<input type="text" class="input w-full" maxlength="60" bind:value={documentNumber} />
				</fieldset>
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">Issued on</legend>
					<input type="date" class="input w-full" bind:value={issuedOn} />
				</fieldset>
			{/if}

			{#if target.requiresExpiryDate}
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">
						{needsIssuingDetails ? 'Valid until' : 'Expiry date'}
					</legend>
					<input type="date" class="input w-full" bind:value={expiry} />
					<p class="label text-xs">
						{needsIssuingDetails
							? 'A Poppynz administrator reviews this — submitting is not the same as being verified.'
							: 'This document type requires a future expiry date.'}
					</p>
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
