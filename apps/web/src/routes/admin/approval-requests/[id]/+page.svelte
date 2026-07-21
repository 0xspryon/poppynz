<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		approveRequest,
		getApprovalRequest,
		getKycDocumentFileUrl,
		rejectApprovalRequest,
		updateKycDocumentExpiry,
		type ApprovalApproveError,
		type ApprovalRequestDetail,
		type KycFileView
	} from '$lib/api/admin-approvals';
	import { centsToDollars } from '$lib/money';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';
	const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

	let detail = $state<ApprovalRequestDetail | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	// Approve dialog
	let approveOpen = $state(false);
	let approvePreset = $state<'6m' | '1y' | '2y' | 'custom'>('1y');
	let approveExpiry = $state('');
	let approving = $state(false);
	let approveError = $state('');

	// Reject dialog
	let rejectOpen = $state(false);
	let rejectReason = $state('');
	let rejecting = $state(false);
	let rejectError = $state('');

	// Fullscreen document viewer
	let viewer = $state<KycFileView | null>(null);
	let viewerLoading = $state(false);
	let viewerError = $state('');
	let viewerExpiry = $state('');
	let savingExpiry = $state(false);
	let expiryError = $state('');
	let expirySaved = $state(false);

	const requestId = $derived(page.params.id ?? '');

	async function load() {
		errorMessage = '';
		const result = await getApprovalRequest(requestId);
		if (result.ok) {
			detail = result.data;
		} else {
			errorMessage =
				result.error.code === 'APPROVAL_REQUEST_NOT_FOUND'
					? 'This approval request no longer exists.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
		if (requestId) void load();
	});

	const applicantName = $derived.by(() => {
		if (!detail) return '';
		const name = [detail.profile.firstName, detail.profile.lastName].filter(Boolean).join(' ');
		return name || detail.user.email;
	});
	const initials = $derived.by(() => {
		if (!detail) return '';
		const first = detail.profile.firstName?.charAt(0) ?? '';
		const last = detail.profile.lastName?.charAt(0) ?? '';
		return (first + last).toUpperCase() || detail.user.email.charAt(0).toUpperCase();
	});
	const requiredDocs = $derived(detail?.documents.filter((doc) => !doc.isOptional) ?? []);
	const optionalDocs = $derived(
		detail?.documents.filter((doc) => doc.isOptional && doc.status !== 'missing') ?? []
	);
	const requiredSubmitted = $derived(requiredDocs.filter((doc) => doc.status !== 'missing').length);
	const warningCount = $derived(
		detail
			? detail.warnings.missingRequiredDocuments.length +
					(detail.warnings.missingServicesOffered ? 1 : 0)
			: 0
	);
	const warningText = $derived.by(() => {
		if (!detail) return '';
		const parts = [
			...detail.warnings.missingRequiredDocuments.map(
				(doc) => `required document missing — ${doc.name.toLowerCase()}`
			),
			...(detail.warnings.missingServicesOffered ? ['no services listed'] : [])
		];
		return parts.join(' · ');
	});
	const location = $derived.by(() => {
		if (!detail) return null;
		const parts = [detail.profile.city, detail.profile.stateProvince].filter(Boolean);
		return parts.length > 0 ? parts.join(', ') : null;
	});

	function waitingText(createdAt: string): string {
		const ms = Date.now() - new Date(createdAt).getTime();
		const hours = Math.floor(ms / (60 * 60 * 1000));
		if (hours < 24) return `${Math.max(hours, 1)} ${hours <= 1 ? 'hour' : 'hours'}`;
		const days = Math.floor(hours / 24);
		return `${days} ${days === 1 ? 'day' : 'days'}`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-CA', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function toDateInputValue(date: Date): string {
		return date.toISOString().slice(0, 10);
	}

	function setPreset(preset: '6m' | '1y' | '2y' | 'custom') {
		approvePreset = preset;
		if (preset === '6m') approveExpiry = toDateInputValue(new Date(Date.now() + YEAR_MS / 2));
		if (preset === '1y') approveExpiry = toDateInputValue(new Date(Date.now() + YEAR_MS));
		if (preset === '2y') approveExpiry = toDateInputValue(new Date(Date.now() + 2 * YEAR_MS));
	}

	function openApprove() {
		approveError = '';
		setPreset('1y');
		approveOpen = true;
	}

	const approveDateValid = $derived(
		approveExpiry !== '' && new Date(approveExpiry).getTime() > Date.now()
	);

	function approveErrorText(error: ApprovalApproveError): string {
		switch (error.code) {
			case 'APPROVAL_ELIGIBILITY_FAILED':
			case 'INVALID_APPROVAL_INPUT':
				return error.message;
			case 'APPROVAL_REQUEST_MISMATCH':
				return 'This request does not match the applicant.';
			case 'APPROVAL_REQUEST_NOT_FOUND':
				return 'This approval request no longer exists.';
			default:
				return RETRY_MESSAGE;
		}
	}

	async function confirmApprove(event: SubmitEvent) {
		event.preventDefault();
		if (!detail || !approveDateValid || approving) return;
		approving = true;
		approveError = '';
		// End of the chosen day so the approval spans the full expiry date.
		const expires = new Date(approveExpiry);
		expires.setHours(23, 59, 59, 999);
		const result = await approveRequest({
			userId: detail.approvalRequest.userId,
			approvalRequestId: detail.approvalRequest.id,
			expiresAt: expires.toISOString()
		});
		if (result.ok) {
			approveOpen = false;
			await load();
		} else {
			approveError = approveErrorText(result.error);
		}
		approving = false;
	}

	async function confirmReject(event: SubmitEvent) {
		event.preventDefault();
		if (rejectReason.trim().length === 0 || rejecting) return;
		rejecting = true;
		rejectError = '';
		const result = await rejectApprovalRequest(requestId, rejectReason.trim());
		if (result.ok) {
			rejectOpen = false;
			rejectReason = '';
			await load();
		} else {
			rejectError =
				result.error.code === 'INVALID_APPROVAL_REQUEST_INPUT' ? result.error.message : RETRY_MESSAGE;
		}
		rejecting = false;
	}

	async function openViewer(documentId: string) {
		viewerLoading = true;
		viewerError = '';
		expiryError = '';
		expirySaved = false;
		const result = await getKycDocumentFileUrl(documentId);
		if (result.ok) {
			viewer = result.data;
			viewerExpiry = result.data.document.expiryDate
				? result.data.document.expiryDate.slice(0, 10)
				: '';
		} else {
			viewerError =
				result.error.code === 'KYC_DOCUMENT_FILE_MISSING'
					? 'This document has no stored file.'
					: RETRY_MESSAGE;
		}
		viewerLoading = false;
	}

	function closeViewer() {
		viewer = null;
	}

	const viewerIsPdf = $derived(
		(viewer?.document.filename ?? '').toLowerCase().endsWith('.pdf')
	);

	async function saveExpiry(event: SubmitEvent) {
		event.preventDefault();
		if (!viewer || savingExpiry) return;
		savingExpiry = true;
		expiryError = '';
		expirySaved = false;
		const iso = viewerExpiry ? new Date(viewerExpiry).toISOString() : null;
		const result = await updateKycDocumentExpiry(viewer.document.id, iso);
		if (result.ok) {
			expirySaved = true;
			await load();
		} else {
			expiryError =
				result.error.code === 'INVALID_KYC_DOCUMENT' ? result.error.message : RETRY_MESSAGE;
		}
		savingExpiry = false;
	}

	function docChip(status: string): ChipStatus {
		if (status === 'approved') return 'approved';
		if (status === 'rejected') return 'rejected';
		if (status === 'missing') return 'missing';
		return 'submitted';
	}
</script>

<svelte:head>
	<title>{applicantName || 'Review'} · Poppynz admin</title>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/admin/approval-requests')} class="font-semibold text-primary">
			Approval queue
		</a>
		<i class="las la-angle-right text-xs" aria-hidden="true"></i>
		<span>{applicantName || '…'}</span>
	</nav>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if detail}
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex min-w-0 items-center gap-3.5">
				<span
					class="flex size-13 shrink-0 items-center justify-center rounded-full bg-base-400
						text-lg font-bold text-secondary"
				>
					{initials}
				</span>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2.5">
						<h1 class="text-xl font-bold text-base-content lg:text-2xl">{applicantName}</h1>
						<StatusChip status={detail.approvalRequest.status} />
					</div>
					<p class="mt-0.5 truncate text-[13px] text-base-content-muted">
						{detail.user.email} · {detail.user.role} · submitted
						{formatDate(detail.approvalRequest.createdAt)}
						{#if detail.approvalRequest.status === 'submitted'}
							· waiting {waitingText(detail.approvalRequest.createdAt)}
						{/if}
					</p>
				</div>
			</div>
			{#if detail.approvalRequest.status === 'submitted'}
				<div class="flex shrink-0 gap-2.5">
					<button type="button" class="btn btn-outline btn-error" onclick={() => (rejectOpen = true)}>
						Reject…
					</button>
					<button type="button" class="btn btn-primary" onclick={openApprove}>Approve…</button>
				</div>
			{/if}
		</div>

		{#if detail.approvalRequest.status === 'rejected' && detail.approvalRequest.reason}
			<p
				class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
					py-2.5 text-[12.5px] leading-relaxed text-error"
			>
				<b>Rejected:</b>
				{detail.approvalRequest.reason}
			</p>
		{/if}

		{#if warningCount > 0 && detail.approvalRequest.status === 'submitted'}
			<div
				class="mt-4 flex items-center gap-3 rounded-[10px] border border-warning-border
					bg-warning-content/40 px-4 py-3"
			>
				<span
					class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent
						text-accent-content"
				>
					<i class="las la-exclamation text-sm" aria-hidden="true"></i>
				</span>
				<span class="text-[13px] font-medium text-warning">
					{warningCount}
					{warningCount === 1 ? 'warning' : 'warnings'}: {warningText}. The applicant was told this
					may slow approval.
				</span>
			</div>
		{/if}

		<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
			<div class="flex flex-col gap-3.5">
				<!-- Profile -->
				<div class="rounded-lg border border-card-border bg-base-100 p-5">
					<div class="mb-3.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
						Profile
					</div>
					<div class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
						<span class="text-outline">Name</span>
						<span class="font-medium text-base-content">{applicantName}</span>
						<span class="text-outline">Gender</span>
						<span class="font-medium text-base-content capitalize">
							{detail.profile.gender ?? '—'}
						</span>
						<span class="text-outline">Date of birth</span>
						<span class="font-medium text-base-content">{detail.profile.dateOfBirth ?? '—'}</span>
						<span class="text-outline">Phone</span>
						<span class="font-medium text-base-content">{detail.profile.phoneNumber ?? '—'}</span>
						<span class="text-outline">Location</span>
						<span class="font-medium text-base-content">{location ?? '—'}</span>
						<span class="text-outline">Language</span>
						<span class="font-medium text-base-content uppercase">{detail.profile.language}</span>
					</div>
					{#if detail.profile.shortBio}
						<div class="mt-3.5 border-t border-base-300 pt-3.5">
							<span class="mb-1 block text-[11.5px] text-outline">Short bio</span>
							<span class="text-[13px] leading-relaxed text-base-content">
								{detail.profile.shortBio}
							</span>
						</div>
					{/if}
				</div>

				<!-- Services -->
				<div class="rounded-lg border border-card-border bg-base-100 p-5">
					<div class="mb-2 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
						Services · {detail.servicesOffered.length}
					</div>
					{#if detail.servicesOffered.length === 0}
						<p class="py-2 text-[13px] text-warning">No services listed.</p>
					{:else}
						{#each detail.servicesOffered as service, index (service.id)}
							<div
								class="flex items-center justify-between gap-3 py-2.5
									{index < detail.servicesOffered.length - 1 ? 'border-b border-base-300' : ''}"
							>
								<div class="min-w-0">
									<div class="text-[13.5px] font-semibold text-base-content">{service.name}</div>
									{#if service.description}
										<div class="truncate text-[11.5px] text-base-content-muted">
											{service.description}
										</div>
									{/if}
								</div>
								<span class="shrink-0 font-display text-sm font-bold text-secondary">
									${centsToDollars(service.hourlyRateCents)}<span
										class="text-[11px] font-normal text-outline">/hr</span
									>
								</span>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<!-- Documents -->
			<div class="self-start rounded-lg border border-card-border bg-base-100 p-5">
				<div class="mb-3.5 flex flex-wrap items-center justify-between gap-2">
					<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
						Documents · {requiredSubmitted} of {requiredDocs.length} required
					</span>
				</div>
				<div class="flex flex-col gap-2.5">
					{#each [...requiredDocs, ...optionalDocs] as doc (doc.documentTypeId)}
						<div
							class="flex flex-wrap items-center gap-3 rounded-[10px] border p-3.5
								{doc.status === 'missing'
								? 'border-dashed border-warning-border bg-warning-content/30'
								: 'border-card-border bg-base-100'}"
						>
							<span
								class="flex size-9.5 shrink-0 items-center justify-center rounded-lg
									{doc.status === 'missing' ? 'bg-warning-content' : 'bg-info-content'}"
							>
								<i
									class="las la-file-alt text-lg
										{doc.status === 'missing' ? 'text-warning' : 'text-info'}"
									aria-hidden="true"
								></i>
							</span>
							<div class="min-w-0 flex-1">
								<div
									class="text-[13.5px] font-semibold
										{doc.status === 'missing' ? 'text-warning' : 'text-base-content'}"
								>
									{doc.name}
									{#if doc.isOptional}
										<span class="ml-1 text-[10.5px] font-medium text-outline">optional</span>
									{/if}
								</div>
								<div
									class="truncate text-[11.5px]
										{doc.status === 'missing' ? 'text-warning' : 'text-base-content-muted'}"
								>
									{#if doc.document}
										{doc.document.filename}
										{#if doc.document.expiryDate}
											· expires {formatDate(doc.document.expiryDate)}
										{/if}
									{:else}
										Required — not submitted
									{/if}
								</div>
							</div>
							<StatusChip status={docChip(doc.status)} />
							{#if doc.document}
								<button
									type="button"
									class="btn btn-outline btn-xs"
									onclick={() => void openViewer(doc.document!.id)}
								>
									View file
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<p class="mt-3.5 flex items-center gap-2 border-t border-base-300 pt-3.5 text-xs text-outline">
					<i class="las la-info-circle text-sm" aria-hidden="true"></i>
					The decision is on the whole request — documents are submitted or missing. Expiry dates
					can be corrected from the fullscreen viewer.
				</p>
				{#if viewerError}
					<p role="alert" class="mt-2 text-xs font-medium text-error">{viewerError}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Approve dialog (8c): explicit expiry required -->
{#if approveOpen && detail}
	<div class="modal modal-open" role="dialog" aria-label="Approve application">
		<form class="modal-box" onsubmit={confirmApprove}>
			<h2 class="text-lg font-bold">Approve {applicantName}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				Approvals expire. Choose how long this approval is valid — you must set an explicit date.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Valid for</legend>
				<div class="flex gap-2">
					{#each [{ key: '6m', label: '6 months' }, { key: '1y', label: '1 year' }, { key: '2y', label: '2 years' }, { key: 'custom', label: 'Custom' }] as preset (preset.key)}
						<button
							type="button"
							class="flex-1 rounded-md border-[1.5px] px-2 py-2.5 text-[13px] font-semibold
								{approvePreset === preset.key
								? 'border-primary bg-base-400 text-secondary shadow-focus-ring'
								: 'border-outline-variant bg-base-100 text-base-content-muted'}"
							onclick={() => setPreset(preset.key as '6m' | '1y' | '2y' | 'custom')}
						>
							{preset.label}
						</button>
					{/each}
				</div>
			</fieldset>

			<fieldset class="fieldset mt-3">
				<legend class="fieldset-legend">Expiry date</legend>
				<input
					type="date"
					class="input w-full"
					bind:value={approveExpiry}
					onchange={() => (approvePreset = 'custom')}
				/>
				<p class="label text-xs">
					Must be a future date. The provider sees this date and can be re-approved later.
				</p>
			</fieldset>

			{#if warningCount > 0}
				<div
					class="mt-3 flex items-center gap-2.5 rounded-md border border-warning-border
						bg-warning-content/40 px-3.5 py-2.5"
				>
					<i class="las la-exclamation-circle text-base text-warning" aria-hidden="true"></i>
					<span class="text-[12.5px] leading-relaxed text-warning">
						This application has {warningCount}
						{warningCount === 1 ? 'warning' : 'warnings'} ({warningText}) — warnings don't block
						approval. Blocking issues (no services, no location) disable approval instead.
					</span>
				</div>
			{/if}

			{#if approveError}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{approveError}</p>
			{/if}

			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					onclick={() => (approveOpen = false)}
					disabled={approving}
				>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={!approveDateValid || approving}>
					{#if approving}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Approve{approveExpiry ? ` until ${formatDate(approveExpiry)}` : ''}
				</button>
			</div>
		</form>
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close"
			onclick={() => (approveOpen = false)}
		></button>
	</div>
{/if}

<!-- Reject dialog (8c): reason required, shown to the provider verbatim -->
{#if rejectOpen}
	<div class="modal modal-open" role="dialog" aria-label="Reject application">
		<form class="modal-box" onsubmit={confirmReject}>
			<h2 class="text-lg font-bold">Reject this application</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				The reason is <b>shown to the provider verbatim</b> — write something specific and
				actionable so they can fix it and resubmit.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Reason · required</legend>
				<textarea
					class="textarea min-h-24 w-full"
					maxlength="500"
					bind:value={rejectReason}
					placeholder="e.g. Your police clearance is older than 6 months. Please upload a recent one and resubmit."
				></textarea>
				<div class="flex justify-between text-xs text-outline">
					<span>Good reasons say what's wrong and how to fix it.</span>
					<span>{rejectReason.length} / 500</span>
				</div>
			</fieldset>

			<div
				class="mt-3 flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
					px-3.5 py-2.5"
			>
				<i class="las la-info-circle text-base text-info" aria-hidden="true"></i>
				<span class="text-[12.5px] text-info">
					Rejection isn't final — the provider can fix the issues and submit again.
				</span>
			</div>

			{#if rejectError}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{rejectError}</p>
			{/if}

			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					onclick={() => (rejectOpen = false)}
					disabled={rejecting}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-error text-error-content"
					disabled={rejectReason.trim().length === 0 || rejecting}
				>
					{#if rejecting}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Reject with reason
				</button>
			</div>
		</form>
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close"
			onclick={() => (rejectOpen = false)}
		></button>
	</div>
{/if}

<!-- Fullscreen PII-safe viewer (8b): view in-browser, edit expiry only -->
{#if viewerLoading}
	<div class="modal modal-open">
		<div class="modal-box flex w-40 items-center justify-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	</div>
{:else if viewer}
	<div class="fixed inset-0 z-50 flex flex-col bg-secondary" role="dialog" aria-label="Document viewer">
		<header
			class="flex items-center justify-between gap-3 border-b border-secondary-content/10 px-5 py-3"
		>
			<div class="flex min-w-0 items-center gap-3">
				<span class="truncate font-display text-base font-bold text-secondary-content">
					{viewer.documentType.name}
				</span>
				<span class="hidden truncate text-xs text-secondary-content-faint sm:inline">
					{viewer.document.filename}
				</span>
				<StatusChip status={docChip(viewer.document.status)} />
			</div>
			<button
				type="button"
				class="flex size-9 shrink-0 items-center justify-center rounded-full
					bg-secondary-content/10 text-secondary-content-muted transition-colors
					hover:text-secondary-content"
				aria-label="Close viewer"
				onclick={closeViewer}
			>
				<i class="las la-times text-lg" aria-hidden="true"></i>
			</button>
		</header>
		<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
			<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
				{#if viewerIsPdf}
					<iframe
						src={viewer.url}
						title="Document preview"
						class="h-full w-full rounded-md bg-base-100"
					></iframe>
				{:else}
					<img
						src={viewer.url}
						alt="Document preview"
						class="max-h-full max-w-full rounded-md shadow-panel"
					/>
				{/if}
			</div>
			<aside
				class="w-full shrink-0 overflow-y-auto border-t border-secondary-content/10 bg-base-100
					p-5 lg:w-80 lg:border-t-0 lg:border-l lg:border-card-border"
			>
				<div class="mb-3.5 text-[10.5px] font-semibold tracking-[0.1em] text-neutral uppercase">
					Document details
				</div>
				<div class="mb-5 grid grid-cols-[90px_1fr] gap-x-2.5 gap-y-2 text-[12.5px]">
					<span class="text-outline">Type</span>
					<span class="font-medium text-base-content">{viewer.documentType.name}</span>
					<span class="text-outline">File</span>
					<span class="truncate font-medium text-base-content">{viewer.document.filename}</span>
					<span class="text-outline">Submitted</span>
					<span class="font-medium text-base-content">
						{formatDate(viewer.document.submittedAt)}
					</span>
				</div>

				<form onsubmit={saveExpiry}>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Expiry date</legend>
						<input type="date" class="input w-full" bind:value={viewerExpiry} />
					</fieldset>
					<p class="mt-1.5 mb-3.5 text-[11.5px] leading-relaxed text-outline">
						Entered by the provider — correct it here if it doesn't match the file.
					</p>
					{#if expiryError}
						<p role="alert" class="mb-2 text-xs font-medium text-error">{expiryError}</p>
					{/if}
					{#if expirySaved}
						<p class="mb-2 text-xs font-medium text-success">Expiry date saved.</p>
					{/if}
					<button type="submit" class="btn w-full btn-primary" disabled={savingExpiry}>
						{#if savingExpiry}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Save expiry date
					</button>
				</form>

				<div
					class="mt-6 flex items-start gap-2.5 rounded-[9px] border border-info-content
						bg-base-200 p-3"
				>
					<i class="las la-shield-alt mt-0.5 text-base text-info" aria-hidden="true"></i>
					<span class="text-[11.5px] leading-relaxed text-info">
						This file contains PII. It never leaves Poppynz servers for download — view it here
						only.
					</span>
				</div>
			</aside>
		</div>
	</div>
{/if}
