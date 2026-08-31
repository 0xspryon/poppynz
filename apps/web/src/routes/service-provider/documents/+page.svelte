<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getOnboardingState,
		type OnboardingDocument,
		type OnboardingState
	} from '$lib/api/onboarding';
	import { uploadKycDocument } from '$lib/api/kyc-documents';
	import {
		addSafetyVerificationItem,
		getSafetyVerification,
		submitSafetyDocument
	} from '$lib/api/safety-verification';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import UploadDocumentDialog from '$lib/components/UploadDocumentDialog.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let onboarding = $state<OnboardingState | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	// Upload modal
	let uploadTarget = $state<OnboardingDocument | null>(null);
	let uploading = $state(false);
	let uploadError = $state('');

	// "Verify through Credibled" adds the check to the applicant's list; the modal
	// explains that adding is not the same as starting, so somebody can queue
	// several checks and pay for them once.
	let addingId = $state<string | null>(null);
	let addedDoc = $state<OnboardingDocument | null>(null);
	/** documentTypeIds sitting in the unpaid Credibled list. */
	let queuedTypeIds = $state<Array<string>>([]);

	async function loadBasket() {
		const result = await getSafetyVerification();
		queuedTypeIds = result.ok ? result.data.basket.map((entry) => entry.documentTypeId) : [];
	}

	async function addToCheckList(doc: OnboardingDocument) {
		if (addingId) return;
		addingId = doc.documentTypeId;
		const result = await addSafetyVerificationItem(doc.documentTypeId);
		if (result.ok) {
			addedDoc = doc;
			await loadBasket();
		} else {
			toast.error(
				result.error.code === 'SAFETY_VERIFICATION_CONFLICT' ||
					result.error.code === 'INVALID_SAFETY_VERIFICATION_INPUT'
					? result.error.message
					: RETRY_MESSAGE,
				{ title: 'Not added to your check list' }
			);
		}
		addingId = null;
	}

	async function load() {
		loading = onboarding === null;
		errorMessage = '';
		const result = await getOnboardingState();
		if (result.ok) {
			onboarding = result.data;
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	// onMount, not $effect: load() reads `onboarding` synchronously, so an
	// effect would track it and re-run on every response — an infinite
	// request loop against /me/onboarding.
	onMount(() => {
		void load();
		void loadBasket();
	});

	const requiredDocs = $derived(onboarding?.documents.filter((doc) => !doc.isOptional) ?? []);
	const optionalDocs = $derived(onboarding?.documents.filter((doc) => doc.isOptional) ?? []);
	const requiredSubmitted = $derived(requiredDocs.filter((doc) => doc.status !== 'missing').length);

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

		// A type that backs safety verification writes the verification record,
		// not an ordinary KYC document — one source of truth for the gate.
		const result = uploadTarget.backsSafetyVerification
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
					expiryDate: input.expiryDate
				});

		if (result.ok) {
			toast.success(
				uploadTarget.backsSafetyVerification
					? `${uploadTarget.name} submitted for review.`
					: `${uploadTarget.name} uploaded.`
			);
			uploadTarget = null;
			// The server drops the matching Credibled item on upload, so the
			// button state has to be refreshed alongside the checklist.
			await Promise.all([load(), loadBasket()]);
		} else if (
			result.error.code === 'INVALID_KYC_DOCUMENT' ||
			result.error.code === 'INVALID_UPLOAD_PRESIGN_INPUT' ||
			result.error.code === 'INVALID_UPLOAD' ||
			result.error.code === 'INVALID_SAFETY_VERIFICATION_INPUT' ||
			result.error.code === 'SAFETY_VERIFICATION_CONFLICT'
		) {
			// The server is rejecting the chosen file/expiry — keep that next to
			// the inputs so it can be corrected in place.
			uploadError = result.error.message;
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Upload failed' });
		}
		uploading = false;
	}

	function formatDate(iso: string | null): string | null {
		if (!iso) return null;
		return new Date(iso).toLocaleDateString('en-CA', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Documents · Poppynz</title>
</svelte:head>

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
			<div class="min-w-0 flex-1">
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
							via Credibled
						</span>
					{/if}
				</div>
				<div class="mt-0.5 text-xs text-base-content-muted">
					{#if doc.document}
						{doc.document.filename}
						{#if doc.document.expiryDate}
							· expires {formatDate(doc.document.expiryDate)}
						{/if}
					{:else if doc.isOptional}
						Optional — add it if it strengthens your profile
					{:else}
						Required — not submitted yet
					{/if}
					{#if !doc.isFetchable && doc.document === null}
						· upload only — not available via Credibled
					{/if}
				</div>
				{#if doc.status === 'rejected' && doc.document?.reason}
					<p
						class="mt-2 max-w-xl rounded-md border border-error-content bg-error-content/40 px-3
							py-2 text-xs leading-relaxed text-error"
					>
						<b>Reason:</b>
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
					Upload yourself
				</button>
				{#if doc.isFetchable}
					{#if queuedTypeIds.includes(doc.documentTypeId)}
						<a
							class="btn btn-sm border-credibled-border bg-credibled-tint text-credibled-text"
							href={resolve('/service-provider/verification')}
							title="Waiting for payment — open Safety verification to pay and start"
						>
							Scheduled via Credibled
						</a>
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
							Verify through Credibled
						</button>
					{/if}
				{/if}
			{:else}
				<button type="button" class="btn btn-outline btn-sm" onclick={() => openUpload(doc)}>
					Replace
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<div class="mx-auto max-w-4xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Documents</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Upload documents yourself, or let Credibled collect the official ones for you.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if onboarding}
		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Required · {requiredSubmitted} of {requiredDocs.length}
		</div>
		<div class="flex flex-col gap-2.5">
			{#each requiredDocs as doc (doc.documentTypeId)}
				{@render documentRow(doc)}
			{/each}
			{#if requiredDocs.length === 0}
				<p
					class="rounded-lg border border-card-border bg-base-100 p-5 text-sm text-base-content-muted"
				>
					No required documents right now.
				</p>
			{/if}
		</div>

		{#if optionalDocs.length > 0}
			<div class="mt-6 mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				Optional
			</div>
			<div class="flex flex-col gap-2.5">
				{#each optionalDocs as doc (doc.documentTypeId)}
					{@render documentRow(doc)}
				{/each}
			</div>
		{/if}
	{/if}
</div>

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
			<h3 class="font-display text-xl font-bold text-base-content">Added to your check list</h3>
			<p class="mt-2 text-sm text-base-content-muted">
				<b>{addedDoc.name}</b> will be collected by Credibled on your behalf. Nothing has been ordered
				or charged yet.
			</p>
			<p class="mt-3 text-sm text-base-content-muted">
				If there are other documents you'd like Credibled to collect, close this and keep adding
				them you'll pay for everything together, once.
			</p>
			<p class="mt-3 text-sm text-base-content-muted">
				When you're ready, head to Safety verification to see the price and start the checks.
			</p>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (addedDoc = null)}>
					Keep adding documents
				</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={() => {
						addedDoc = null;
						void goto(resolve('/service-provider/verification'));
					}}
				>
					Review and start
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (addedDoc = null)}
			aria-label="Close"
		></button>
	</div>
{/if}
