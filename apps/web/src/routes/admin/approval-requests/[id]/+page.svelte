<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		approveRequest,
		getApprovalRequest,
		getKycDocumentFileUrl,
		rejectApprovalRequest,
		revokeApproval,
		type ApprovalApproveError,
		type ApprovalRequestDetail,
		type KycFileView
	} from '$lib/api/admin-approvals';
	import { centsToDollars } from '$lib/money';
	import ApproveRequestDialog from '$lib/components/admin/ApproveRequestDialog.svelte';
	import DocumentViewerDialog from '$lib/components/admin/DocumentViewerDialog.svelte';
	import RejectRequestDialog from '$lib/components/admin/RejectRequestDialog.svelte';
	import RevokeApprovalDialog from '$lib/components/admin/RevokeApprovalDialog.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let detail = $state<ApprovalRequestDetail | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	// Approve dialog
	let approveOpen = $state(false);
	let approving = $state(false);

	// Reject dialog
	let rejectOpen = $state(false);
	let rejecting = $state(false);

	// Revoke dialog (live approval only)
	let revokeOpen = $state(false);
	let revoking = $state(false);

	// Fullscreen document viewer
	let viewer = $state<KycFileView | null>(null);
	let viewerLoading = $state(false);

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

	function openApprove() {
		approveOpen = true;
	}

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

	async function confirmApprove(expiryDate: string) {
		if (!detail || approving) return;
		approving = true;
		// End of the chosen day (local time) so the approval spans the full expiry date.
		const expires = new Date(`${expiryDate}T23:59:59.999`);
		const result = await approveRequest({
			userId: detail.approvalRequest.userId,
			approvalRequestId: detail.approvalRequest.id,
			expiresAt: expires.toISOString()
		});
		if (result.ok) {
			approveOpen = false;
			toast.success(`${applicantName} is approved until ${formatDate(expires.toISOString())}.`);
			await load();
		} else {
			toast.error(approveErrorText(result.error), { title: 'Approval failed' });
		}
		approving = false;
	}

	async function confirmReject(reason: string) {
		if (rejecting) return;
		rejecting = true;
		const result = await rejectApprovalRequest(requestId, reason);
		if (result.ok) {
			rejectOpen = false;
			toast.success(`${applicantName}'s application was rejected.`);
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_APPROVAL_REQUEST_INPUT' ? result.error.message : RETRY_MESSAGE,
				{ title: 'Rejection failed' }
			);
		}
		rejecting = false;
	}

	async function confirmRevoke(reason: string) {
		if (!detail?.currentApproval || revoking) return;
		revoking = true;
		const result = await revokeApproval(detail.currentApproval.id, reason);
		if (result.ok) {
			revokeOpen = false;
			toast.success(`${applicantName}'s approval was revoked.`);
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_APPROVAL_INPUT'
					? result.error.message
					: result.error.code === 'APPROVAL_NOT_FOUND'
						? 'No active approval was found — it may already be revoked or expired.'
						: RETRY_MESSAGE,
				{ title: 'Revocation failed' }
			);
		}
		revoking = false;
	}

	async function openViewer(documentId: string) {
		viewerLoading = true;
		const result = await getKycDocumentFileUrl(documentId);
		if (result.ok) {
			viewer = result.data;
		} else {
			toast.error(
				result.error.code === 'KYC_DOCUMENT_FILE_MISSING'
					? 'This document has no stored file.'
					: RETRY_MESSAGE,
				{ title: 'Could not open document' }
			);
		}
		viewerLoading = false;
	}

	function closeViewer() {
		viewer = null;
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

		{#if detail.currentApproval}
			<div
				class="mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-success-content
					bg-success-content/40 px-4 py-3"
			>
				<i class="las la-user-shield text-lg text-success" aria-hidden="true"></i>
				<span class="flex-1 text-[13px] font-medium text-success">
					Currently approved — verified until {formatDate(detail.currentApproval.expiresAt)}
					(granted {formatDate(detail.currentApproval.grantedAt)}).
				</span>
				<button
					type="button"
					class="btn btn-outline btn-sm btn-error"
					onclick={() => (revokeOpen = true)}
				>
					Revoke approval…
				</button>
			</div>
		{/if}

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
			</div>
		</div>
	{/if}
</div>

<ApproveRequestDialog
	open={approveOpen && detail !== null}
	{applicantName}
	{warningCount}
	{warningText}
	busy={approving}
	onconfirm={(expiryDate) => void confirmApprove(expiryDate)}
	oncancel={() => (approveOpen = false)}
/>

<RejectRequestDialog
	open={rejectOpen}
	busy={rejecting}
	onconfirm={(reason) => void confirmReject(reason)}
	oncancel={() => (rejectOpen = false)}
/>

<RevokeApprovalDialog
	open={revokeOpen && detail?.currentApproval != null}
	{applicantName}
	busy={revoking}
	onconfirm={(reason) => void confirmRevoke(reason)}
	oncancel={() => (revokeOpen = false)}
/>

<DocumentViewerDialog
	{viewer}
	loading={viewerLoading}
	onclose={closeViewer}
	onsaved={() => void load()}
/>
