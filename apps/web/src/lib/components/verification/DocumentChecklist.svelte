<script lang="ts">
	import { formatCalendarDate } from '$lib/date';
	/** A documents checklist (required, then optional) with the upload dialog
	 * and the "Verify through Credibled" check-list action. Data-in: the caller
	 * loads the checklist and the unpaid check list and refetches both through
	 * `onchanged`. The Credibled check list is reached via `checkListHref` or,
	 * when it sits on the same page, `oncheckList`. */
	import type { ResolvedPathname } from '$app/types';
	import type { OnboardingDocument } from '$lib/api/onboarding';
	import { uploadKycDocument } from '$lib/api/kyc-documents';
	import { addSafetyVerificationItem, submitSafetyDocument } from '$lib/api/safety-verification';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import UploadDocumentDialog from '$lib/components/UploadDocumentDialog.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { documentUploadErrorText, safetyVerificationErrorText } from './error-messages';

	interface Props {
		documents: Array<OnboardingDocument>;
		/** documentTypeIds sitting in the unpaid Credibled list. */
		queuedTypeIds: Array<string>;
		onchanged: () => Promise<void>;
		checkListHref?: ResolvedPathname;
		oncheckList?: () => void;
		/** Where the check list lives, for the "added" dialog copy. */
		checkListPlace?: string;
		/** Hide the "Required · n of m" heading when the caller has its own. */
		showRequiredHeading?: boolean;
		/** Shown when nothing is required; empty hides the line altogether. */
		emptyRequiredText?: string;
	}

	let {
		documents,
		queuedTypeIds,
		onchanged,
		checkListHref,
		oncheckList,
		checkListPlace = m.verify_check_list_place_default(),
		showRequiredHeading = true,
		emptyRequiredText = m.verify_empty_required_default()
	}: Props = $props();

	const RETRY_MESSAGE = m.common_error_generic();

	// Upload modal
	let uploadTarget = $state<OnboardingDocument | null>(null);
	let uploading = $state(false);
	let uploadError = $state('');

	// "Verify through Credibled" adds the check to the applicant's list; the modal
	// explains that adding is not the same as starting, so somebody can queue
	// several checks and pay for them once.
	let addingId = $state<string | null>(null);
	let addedDoc = $state<OnboardingDocument | null>(null);

	const requiredDocs = $derived(documents.filter((doc) => !doc.isOptional));
	const optionalDocs = $derived(documents.filter((doc) => doc.isOptional));
	const requiredSubmitted = $derived(requiredDocs.filter((doc) => doc.status !== 'missing').length);

	async function addToCheckList(doc: OnboardingDocument) {
		if (addingId) return;
		addingId = doc.documentTypeId;
		const result = await addSafetyVerificationItem(doc.documentTypeId);
		if (result.ok) {
			addedDoc = doc;
			await onchanged();
		} else {
			toast.error(
				result.error.code === 'SAFETY_VERIFICATION_CONFLICT' ||
					result.error.code === 'INVALID_SAFETY_VERIFICATION_INPUT'
					? safetyVerificationErrorText(result.error)
					: RETRY_MESSAGE,
				{ title: m.verify_toast_not_added_title() }
			);
		}
		addingId = null;
	}

	function chipStatus(doc: OnboardingDocument): ChipStatus {
		return doc.status === 'missing' ? 'missing' : doc.status;
	}

	function openUpload(doc: OnboardingDocument) {
		uploadTarget = doc;
		uploadError = '';
	}

	function closeUpload() {
		if (uploading) return;
		uploadTarget = null;
	}

	async function submitUpload(input: {
		file: File;
		expiryDate: string | null;
		issuingAuthority?: string;
		documentNumber?: string;
		issuedOn?: string;
	}) {
		if (!uploadTarget || uploading) return;
		uploading = true;
		uploadError = '';

		// The safety-gate type writes the verification record, not an ordinary
		// KYC document — one source of truth for the gate.
		const result = uploadTarget.isSafetyGate
			? await submitSafetyDocument({
					file: input.file,
					issuingAuthority: input.issuingAuthority ?? '',
					documentNumber: input.documentNumber ?? '',
					issuedOn: input.issuedOn ?? '',
					expiresOn: (input.expiryDate ?? '').slice(0, 10)
				})
			: await uploadKycDocument({
					documentTypeId: uploadTarget.documentTypeId,
					file: input.file,
					expiryDate: input.expiryDate,
					issuedOn: input.issuedOn ?? null
				});

		if (result.ok) {
			toast.success(
				uploadTarget.isSafetyGate
					? m.verify_toast_submitted_for_review({ name: uploadTarget.name })
					: m.verify_toast_uploaded({ name: uploadTarget.name })
			);
			uploadTarget = null;
			// The server drops the matching Credibled item on upload, so the
			// button state has to be refreshed alongside the checklist.
			await onchanged();
		} else if (
			result.error.code === 'INVALID_KYC_DOCUMENT' ||
			result.error.code === 'INVALID_UPLOAD_PRESIGN_INPUT' ||
			result.error.code === 'INVALID_UPLOAD' ||
			result.error.code === 'INVALID_SAFETY_VERIFICATION_INPUT' ||
			result.error.code === 'SAFETY_VERIFICATION_CONFLICT'
		) {
			// The server is rejecting the chosen file/expiry — keep that next to
			// the inputs so it can be corrected in place.
			uploadError = documentUploadErrorText(result.error);
		} else {
			toast.error(RETRY_MESSAGE, { title: m.verify_toast_upload_failed_title() });
		}
		uploading = false;
	}

	// Expiry dates are calendar dates — never shifted by the viewer's zone (UAT #28).
	function formatDate(iso: string | null): string | null {
		return iso ? formatCalendarDate(iso) : null;
	}
</script>

{#snippet checkListLink(classes: string, label: string)}
	{#if checkListHref}
		<a class={classes} href={checkListHref} title={m.verify_waiting_for_payment()}>
			{label}
		</a>
	{:else}
		<button
			type="button"
			class={classes}
			title={m.verify_waiting_for_payment()}
			onclick={oncheckList}
		>
			{label}
		</button>
	{/if}
{/snippet}

{#snippet documentRow(doc: OnboardingDocument)}
	<div
		class="rounded-[10px] border bg-base-100 p-4
			{doc.status === 'missing'
			? doc.isOptional
				? 'border-dashed border-outline-variant'
				: 'border-dashed border-warning-border'
			: 'border-card-border'}"
	>
		<div class="flex flex-wrap items-center gap-3.5">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-lg
					{doc.status === 'approved'
					? 'bg-success-content'
					: doc.status === 'missing'
						? 'bg-base-300'
						: 'bg-info-content'}"
			>
				<i
					class="las la-file-alt text-lg
						{doc.status === 'approved'
						? 'text-success'
						: doc.status === 'missing'
							? 'text-outline'
							: 'text-info'}"
					aria-hidden="true"
				></i>
			</span>
			<div class="min-w-48 flex-1">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm font-semibold text-base-content">{doc.name}</span>
					{#if doc.isFetchable}
						<span
							class="flex items-center gap-1.5 rounded-pill bg-credibled-tint px-2 py-0.5
								text-[10.5px] font-semibold whitespace-nowrap text-credibled-text"
						>
							<span
								class="flex size-3 items-center justify-center rounded-full border
									border-credibled"
							></span>
							{m.verify_via_credibled()}
						</span>
					{/if}
				</div>
				<div class="mt-0.5 text-xs text-base-content-muted">
					{#if doc.document}
						{#if doc.document.source === 'credibled'}
							{m.verify_collected_by_credibled()}
						{:else}
							{doc.document.filename}
						{/if}
						{#if doc.document.expiryDate}
							{m.verify_doc_expires({ date: formatDate(doc.document.expiryDate) ?? '' })}
						{/if}
					{:else if doc.isOptional}
						{m.verify_doc_optional_hint()}
					{:else}
						{m.verify_doc_required_missing()}
					{/if}
					{#if !doc.isFetchable && doc.document === null}
						{m.verify_doc_upload_only()}
					{/if}
				</div>
				{#if doc.status === 'rejected' && doc.document?.reason}
					<p
						class="mt-2 max-w-xl rounded-md border border-error-content bg-error-content/40 px-3
							py-2 text-xs leading-relaxed text-error"
					>
						<b>{m.verify_reason_label()}</b>
						{doc.document.reason}
					</p>
				{/if}
			</div>
			<StatusChip status={chipStatus(doc)} />
			{#if doc.status === 'missing'}
				<!-- Uploading it yourself is free and instant, so it leads. -->
				<button
					type="button"
					class="btn btn-outline btn-sm btn-secondary"
					onclick={() => openUpload(doc)}
				>
					{m.verify_upload_yourself()}
				</button>
				{#if doc.isFetchable}
					{#if queuedTypeIds.includes(doc.documentTypeId)}
						{@render checkListLink(
							'btn btn-sm border-credibled-border bg-credibled-tint text-credibled-text',
							m.verify_scheduled_via_credibled()
						)}
					{:else}
						<button
							type="button"
							class="btn btn-outline btn-sm border-credibled-border text-credibled-text"
							disabled={addingId !== null}
							onclick={() => addToCheckList(doc)}
						>
							{#if addingId === doc.documentTypeId}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							{m.verify_verify_through_credibled()}
						</button>
					{/if}
				{/if}
			{:else}
				<button type="button" class="btn btn-outline btn-sm" onclick={() => openUpload(doc)}>
					{m.verify_replace()}
				</button>
			{/if}
		</div>
	</div>
{/snippet}

{#if showRequiredHeading}
	<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
		{m.verify_required_heading({ submitted: requiredSubmitted, total: requiredDocs.length })}
	</div>
{/if}
<div class="flex flex-col gap-2.5">
	{#each requiredDocs as doc (doc.documentTypeId)}
		{@render documentRow(doc)}
	{/each}
	{#if requiredDocs.length === 0 && emptyRequiredText}
		<p class="rounded-lg border border-card-border bg-base-100 p-5 text-sm text-base-content-muted">
			{emptyRequiredText}
		</p>
	{/if}
</div>

{#if optionalDocs.length > 0}
	<div
		class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase
			{requiredDocs.length > 0 || emptyRequiredText ? 'mt-6' : ''}"
	>
		{m.verify_optional_heading()}
	</div>
	<div class="flex flex-col gap-2.5">
		{#each optionalDocs as doc (doc.documentTypeId)}
			{@render documentRow(doc)}
		{/each}
	</div>
{/if}

<UploadDocumentDialog
	target={uploadTarget}
	busy={uploading}
	error={uploadError}
	onsubmit={(input) => void submitUpload(input)}
	oncancel={closeUpload}
/>

{#if addedDoc}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">{m.verify_added_title()}</h3>
			<p class="mt-2 text-sm text-base-content-muted">
				<b>{addedDoc.name}</b>{m.verify_added_collected_after()}
			</p>
			<p class="mt-3 text-sm text-base-content-muted">
				{m.verify_added_keep_adding()}
			</p>
			<p class="mt-3 text-sm text-base-content-muted">
				{m.verify_added_when_ready({ place: checkListPlace })}
			</p>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (addedDoc = null)}>
					{m.verify_add_more_checks()}
				</button>
				{#if checkListHref}
					<a class="btn btn-primary" href={checkListHref} onclick={() => (addedDoc = null)}>
						{m.verify_review_and_start()}
					</a>
				{:else}
					<button
						type="button"
						class="btn btn-primary"
						onclick={() => {
							addedDoc = null;
							oncheckList?.();
						}}
					>
						{m.verify_review_and_start()}
					</button>
				{/if}
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (addedDoc = null)}
			aria-label={m.common_close()}
		></button>
	</div>
{/if}
