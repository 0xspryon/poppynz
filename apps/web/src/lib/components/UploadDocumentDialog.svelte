<script lang="ts">
	/** Upload/replace dialog for a KYC document (provider documents page).
	 * Owns the file + expiry inputs; emits them on submit. Opens while
	 * `target` is set. */
	import type { OnboardingDocument } from '$lib/api/onboarding';
	import { todayInputValue } from '$lib/date';
	import { m } from '$lib/paraglide/messages';

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

	const needsIssuingDetails = $derived(target?.isSafetyGate === true);

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
				: issuedOn
					? { issuedOn }
					: {})
		});
	}
</script>

{#if target}
	<div class="modal modal-open" role="dialog" aria-label={m.verify_upload_dialog_label()}>
		<!-- UAT #33: daisyUI's .label doesn't wrap, which pushed the box wider
		     than the window on the Vulnerable Sector Check; cap the width and
		     let every hint wrap. -->
		<form class="modal-box w-full max-w-lg overflow-x-hidden" onsubmit={submit}>
			<h2 class="text-lg font-bold break-words">
				{target.document
					? m.verify_upload_title_replace({ name: target.name })
					: m.verify_upload_title_upload({ name: target.name })}
			</h2>
			<p class="mt-1 text-xs text-base-content-muted">
				{m.verify_upload_hint()}
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.verify_upload_file()}</legend>
				<input
					type="file"
					class="file-input w-full"
					accept={ACCEPTED_TYPES}
					onchange={onFileChange}
				/>
			</fieldset>

			{#if needsIssuingDetails}
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">{m.verify_upload_issuing_authority()}</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						placeholder={m.verify_upload_issuing_authority_placeholder()}
						bind:value={issuingAuthority}
					/>
				</fieldset>
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">{m.verify_upload_document_number()}</legend>
					<input type="text" class="input w-full" maxlength="60" bind:value={documentNumber} />
				</fieldset>
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">{m.verify_upload_issued_on()}</legend>
					<input type="date" class="input w-full" bind:value={issuedOn} />
				</fieldset>
			{/if}

			{#if !needsIssuingDetails}
				<!-- UAT #31: the issue date as printed on the document. -->
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">{m.verify_upload_issued_on_optional()}</legend>
					<input type="date" class="input w-full" max={todayInputValue()} bind:value={issuedOn} />
				</fieldset>
			{/if}

			{#if target.requiresExpiryDate}
				<fieldset class="fieldset mt-2">
					<legend class="fieldset-legend">
						{needsIssuingDetails ? m.verify_upload_valid_until() : m.verify_upload_expiry_date()}
					</legend>
					<input type="date" class="input w-full" bind:value={expiry} />
					<p class="label text-xs whitespace-normal">
						{needsIssuingDetails ? m.verify_upload_review_hint() : m.verify_upload_expiry_hint()}
					</p>
				</fieldset>
			{/if}

			{#if error}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={!canSubmit || busy}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{target.document ? m.verify_upload_submit_replace() : m.verify_upload_submit_new()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
