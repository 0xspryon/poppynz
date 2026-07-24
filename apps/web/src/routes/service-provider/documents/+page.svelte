<script lang="ts">
	import {
		getOnboardingState,
		type OnboardingDocument,
		type OnboardingState
	} from '$lib/api/onboarding';
	import { uploadKycDocument } from '$lib/api/kyc-documents';
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

	$effect(() => {
		void load();
	});

	const requiredDocs = $derived(onboarding?.documents.filter((doc) => !doc.isOptional) ?? []);
	const optionalDocs = $derived(onboarding?.documents.filter((doc) => doc.isOptional) ?? []);
	const requiredSubmitted = $derived(
		requiredDocs.filter((doc) => doc.status !== 'missing').length
	);

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

	async function submitUpload(input: { file: File; expiryDate: string | null }) {
		if (!uploadTarget || uploading) return;
		uploading = true;
		uploadError = '';
		const result = await uploadKycDocument({
			documentTypeId: uploadTarget.documentTypeId,
			file: input.file,
			expiryDate: input.expiryDate
		});
		if (result.ok) {
			toast.success(`${uploadTarget.name} uploaded.`);
			uploadTarget = null;
			await load();
		} else if (
			result.error.code === 'INVALID_KYC_DOCUMENT' ||
			result.error.code === 'INVALID_UPLOAD_PRESIGN_INPUT' ||
			result.error.code === 'INVALID_UPLOAD'
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
				{#if doc.isFetchable}
					<button
						type="button"
						class="btn btn-outline btn-sm cursor-not-allowed border-credibled-border
							text-credibled-text opacity-60"
						disabled
						title="Credibled integration is coming soon"
					>
						Fetch via Credibled
					</button>
				{/if}
				<button
					type="button"
					class="btn btn-outline btn-sm btn-secondary"
					onclick={() => openUpload(doc)}
				>
					Upload yourself
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-outline btn-sm"
					onclick={() => openUpload(doc)}
				>
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
		{#if onboarding.documents.some((doc) => doc.isFetchable)}
			<!-- Credibled hero (integration pending — fetch stays disabled) -->
			<div
				class="mb-6 flex items-center gap-4 rounded-lg border border-credibled-border bg-base-100
					px-5 py-4"
			>
				<span
					class="flex size-11 shrink-0 items-center justify-center rounded-full border-[1.5px]
						border-credibled"
				>
					<i class="las la-fingerprint text-xl text-credibled" aria-hidden="true"></i>
				</span>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2.5">
						<span class="font-display text-base font-bold text-base-content">
							Verification by Credibled
						</span>
						<span
							class="rounded-pill bg-credibled-tint px-2.5 py-0.5 text-[10.5px] font-semibold
								text-credibled-text"
						>
							Coming soon
						</span>
					</div>
					<p class="mt-0.5 text-[13px] leading-relaxed text-base-content-muted">
						Credibled will collect your official checks (criminal record, references) directly —
						until then, upload those documents yourself below.
					</p>
				</div>
			</div>
		{/if}

		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Required · {requiredSubmitted} of {requiredDocs.length}
		</div>
		<div class="flex flex-col gap-2.5">
			{#each requiredDocs as doc (doc.documentTypeId)}
				{@render documentRow(doc)}
			{/each}
			{#if requiredDocs.length === 0}
				<p class="rounded-lg border border-card-border bg-base-100 p-5 text-sm text-base-content-muted">
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
