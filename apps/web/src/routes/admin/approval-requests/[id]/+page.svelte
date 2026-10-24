<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		approveRequest,
		getApprovalRequest,
		getKycDocumentFileUrl,
		getSafetyDocumentFileUrl,
		rejectApprovalRequest,
		reviewKycDocument,
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
	import VouchesCard from '$lib/components/admin/VouchesCard.svelte';
	import GeneralRemarksCard from '$lib/components/admin/GeneralRemarksCard.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { toast } from '$lib/toast.svelte';
	import { formatCalendarDate } from '$lib/date';
	import { SvelteSet } from 'svelte/reactivity';

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

	// Per-document review (UAT #27)
	const reviewingIds = new SvelteSet<string>();
	let rejectingDoc = $state<{ id: string; name: string } | null>(null);
	let rejectDocReason = $state('');

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
	const blockers = $derived(detail?.approvalBlockers ?? []);
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
			case 'APPROVAL_INCOMPLETE':
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
				result.error.code === 'INVALID_APPROVAL_REQUEST_INPUT'
					? result.error.message
					: RETRY_MESSAGE,
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

	async function reviewDocument(
		doc: { id: string; name: string },
		decision: 'approve' | 'reject',
		reason?: string
	) {
		if (reviewingIds.has(doc.id)) return;
		reviewingIds.add(doc.id);
		const result = await reviewKycDocument(doc.id, { decision, reason: reason ?? null });
		if (result.ok) {
			toast.success(`${doc.name} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
			rejectingDoc = null;
			rejectDocReason = '';
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_KYC_DOCUMENT' ? result.error.message : RETRY_MESSAGE,
				{ title: `${doc.name} not ${decision === 'approve' ? 'approved' : 'rejected'}` }
			);
		}
		reviewingIds.delete(doc.id);
	}

	/** The safety-gate document lives on the verification record; it opens
	 * in a new tab from a short-lived link (UAT #29). */
	async function openSafetyDocument(verificationId: string) {
		const result = await getSafetyDocumentFileUrl(verificationId);
		if (result.ok) {
			window.open(result.data.url, '_blank', 'noopener');
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Could not open document' });
		}
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
					<button
						type="button"
						class="btn btn-outline btn-error"
						onclick={() => (rejectOpen = true)}
					>
						Reject…
					</button>
					<button
						type="button"
						class="btn btn-primary"
						onclick={openApprove}
						disabled={blockers.length > 0}
						title={blockers.length > 0 ? 'Resolve the items listed below first' : undefined}
					>
						Approve…
					</button>
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

		{#if blockers.length > 0 && detail.approvalRequest.status === 'submitted'}
			<!-- UAT #25/#30: approval is refused server-side until these are resolved. -->
			<div
				role="status"
				class="mt-4 rounded-[10px] border border-error-content bg-error-content/40 px-4 py-3"
			>
				<p class="text-[13px] font-semibold text-error">
					This account can't be approved yet. It stays in the queue until:
				</p>
				<ul class="mt-1.5 list-disc pl-5 text-[12.5px] text-error">
					{#each blockers as blocker (blocker.kind + ('documentTypeId' in blocker ? blocker.documentTypeId : ''))}
						<li>{blocker.message}</li>
					{/each}
				</ul>
			</div>
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

				<!-- Services: what a helper offers, or what a family needs (context
				     only — needs are never a condition of a family's approval). -->
				<div class="rounded-lg border border-card-border bg-base-100 p-5">
					{#if detail.applicantRole === 'family'}
						<div class="mb-2 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
							Services needed · {detail.servicesNeeded.length}
						</div>
						{#if detail.servicesNeeded.length === 0}
							<p class="py-2 text-[13px] text-base-content-muted">No needs listed yet.</p>
						{:else}
							{#each detail.servicesNeeded as need, index (need.id)}
								<div
									class="py-2.5
										{index < detail.servicesNeeded.length - 1 ? 'border-b border-base-300' : ''}"
								>
									<div class="text-[13.5px] font-semibold text-base-content">{need.name}</div>
									{#if need.description}
										<div class="truncate text-[11.5px] text-base-content-muted">
											{need.description}
										</div>
									{/if}
								</div>
							{/each}
						{/if}
					{:else}
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
					{/if}
				</div>

				{#if detail.applicantRole === 'service-provider'}
					<VouchesCard vouches={detail.vouches} onchanged={load} />
				{/if}
				<GeneralRemarksCard
					requestId={detail.approvalRequest.id}
					remarks={detail.approvalRequest.generalRemarks}
					updatedAt={detail.approvalRequest.generalRemarksUpdatedAt}
					onchanged={load}
				/>
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
										{#if doc.document.source === 'credibled'}
											Collected by Credibled — see the safety verification for the report
										{:else}
											{doc.document.filename}
										{/if}
										{#if doc.document.expiryDate}
											· expires {formatCalendarDate(doc.document.expiryDate)}
										{/if}
									{:else}
										Required — not submitted
									{/if}
								</div>
							</div>
							<StatusChip status={docChip(doc.status)} />
							<!-- A fetched document has no file of ours to open. -->
							{#if doc.document && doc.document.source !== 'credibled'}
								<button
									type="button"
									class="btn btn-outline btn-xs"
									onclick={() =>
										void (doc.isSafetyGate
											? openSafetyDocument(doc.document!.id)
											: openViewer(doc.document!.id))}
								>
									View file
								</button>
							{/if}
							{#if doc.document && doc.status === 'submitted'}
								{#if doc.isSafetyGate}
									<!-- The gate's verdict is decided with the verification itself. -->
									<a href={resolve('/admin/safety-verifications')} class="btn btn-ghost btn-xs">
										Decide in Safety verifications
									</a>
								{:else}
									{@const ref = { id: doc.document.id, name: doc.name }}
									<button
										type="button"
										class="btn btn-primary btn-xs"
										disabled={reviewingIds.has(ref.id)}
										onclick={() => void reviewDocument(ref, 'approve')}
									>
										Approve
									</button>
									<button
										type="button"
										class="btn btn-outline btn-error btn-xs"
										disabled={reviewingIds.has(ref.id)}
										onclick={() => (rejectingDoc = ref)}
									>
										Reject
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
				<p
					class="mt-3.5 flex items-center gap-2 border-t border-base-300 pt-3.5 text-xs text-outline"
				>
					<i class="las la-info-circle text-sm" aria-hidden="true"></i>
					Every required document needs its own approval before the account can be approved.
					Expiry dates can be corrected from the fullscreen viewer.
				</p>
			</div>
		</div>
	{/if}
</div>

<ApproveRequestDialog
	open={approveOpen && detail !== null}
	{applicantName}
	blockers={blockers.map((blocker) => blocker.message)}
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

{#if rejectingDoc}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Reject document">
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">Reject {rejectingDoc.name}</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				The applicant sees this reason and uploads a new file.
			</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectDocReason}
				placeholder="The photo is blurry — please upload a clearer one."
			></textarea>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (rejectingDoc = null)}>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectDocReason.trim().length === 0 || reviewingIds.has(rejectingDoc.id)}
					onclick={() =>
						rejectingDoc && void reviewDocument(rejectingDoc, 'reject', rejectDocReason.trim())}
				>
					Reject
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close"
			onclick={() => (rejectingDoc = null)}
		></button>
	</div>
{/if}
