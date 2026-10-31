<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		approveRequest,
		describeApprovalBlocker,
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
	import { formatMoney } from '$lib/money';
	import ApproveRequestDialog from '$lib/components/admin/ApproveRequestDialog.svelte';
	import DocumentViewerDialog from '$lib/components/admin/DocumentViewerDialog.svelte';
	import DocumentViewerFrame from '$lib/components/admin/DocumentViewerFrame.svelte';
	import RejectRequestDialog from '$lib/components/admin/RejectRequestDialog.svelte';
	import RevokeApprovalDialog from '$lib/components/admin/RevokeApprovalDialog.svelte';
	import VouchesCard from '$lib/components/admin/VouchesCard.svelte';
	import GeneralRemarksCard from '$lib/components/admin/GeneralRemarksCard.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { toast } from '$lib/toast.svelte';
	import { formatCalendarDate, formatDate as formatInstant } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = m.common_error_generic();

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
					? m.admin_requests_error_not_found()
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
	const requiredSubmitted = $derived(
		requiredDocs.filter((doc) => doc.status !== 'missing' && doc.status !== 'expired').length
	);
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
			...detail.warnings.missingRequiredDocuments.map((doc) =>
				m.admin_requests_warning_required_doc({ name: doc.name.toLowerCase() })
			),
			...(detail.warnings.missingServicesOffered ? [m.admin_requests_warning_no_services()] : [])
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
		if (hours < 24) return m.admin_requests_waiting_hours({ count: Math.max(hours, 1) });
		const days = Math.floor(hours / 24);
		return m.admin_requests_waiting_days({ count: days });
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return formatInstant(iso);
	}

	/** The account role as worded in the header line (raw role in English). */
	function userRoleLabel(role: string | null | undefined): string {
		if (role === 'family') return m.admin_requests_user_role_family();
		if (role === 'service-provider') return m.admin_requests_user_role_service_provider();
		if (role === 'admin') return m.admin_requests_user_role_admin();
		return role ?? '—';
	}

	function genderLabel(gender: string | null | undefined): string {
		if (gender === 'male') return m.admin_requests_gender_male();
		if (gender === 'female') return m.admin_requests_gender_female();
		return gender ?? '—';
	}

	/** Profile language by name; the retired 'es' and anything unknown read as English. */
	function languageLabel(language: string | null | undefined): string {
		return language === 'fr' ? m.admin_requests_language_fr() : m.admin_requests_language_en();
	}

	/** The server's eligibility refusal (APPROVAL_ELIGIBILITY_FAILED) is worded in
	 * English; known reasons are matched and localized, the rest fall back. */
	function eligibilityText(message: string): string {
		switch (message) {
			case 'Applicant profile was not found.':
				return m.admin_requests_error_eligibility_profile();
			case 'Only families and service providers are approved.':
				return m.admin_requests_error_eligibility_role();
			case 'Provider must save a location before approval.':
				return m.admin_requests_error_eligibility_location();
			case 'Provider must have at least one active service before approval.':
				return m.admin_requests_error_eligibility_service();
			case 'Applicant must complete Poppynz safety verification before approval.':
				return m.admin_requests_error_eligibility_safety();
			default:
				return m.admin_requests_error_eligibility_generic();
		}
	}

	function openApprove() {
		approveOpen = true;
	}

	function approveErrorText(error: ApprovalApproveError): string {
		switch (error.code) {
			case 'APPROVAL_ELIGIBILITY_FAILED':
				return eligibilityText(error.message);
			case 'APPROVAL_INCOMPLETE':
				return m.admin_requests_error_incomplete();
			case 'INVALID_APPROVAL_INPUT':
				return m.admin_requests_error_approve_invalid();
			case 'APPROVAL_REQUEST_MISMATCH':
				return m.admin_requests_error_mismatch();
			case 'APPROVAL_REQUEST_NOT_FOUND':
				return m.admin_requests_error_not_found();
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
			toast.success(
				m.admin_requests_toast_approved({
					name: applicantName,
					date: formatDate(expires.toISOString())
				})
			);
			await load();
		} else {
			toast.error(approveErrorText(result.error), {
				title: m.admin_requests_toast_approve_failed()
			});
		}
		approving = false;
	}

	async function confirmReject(reason: string) {
		if (rejecting) return;
		rejecting = true;
		const result = await rejectApprovalRequest(requestId, reason);
		if (result.ok) {
			rejectOpen = false;
			toast.success(m.admin_requests_toast_rejected({ name: applicantName }));
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_APPROVAL_REQUEST_INPUT'
					? m.admin_requests_error_reject_invalid()
					: RETRY_MESSAGE,
				{ title: m.admin_requests_toast_reject_failed() }
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
			toast.success(m.admin_requests_toast_revoked({ name: applicantName }));
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_APPROVAL_INPUT'
					? m.admin_requests_error_revoke_invalid()
					: result.error.code === 'APPROVAL_NOT_FOUND'
						? m.admin_requests_error_revoke_not_found()
						: RETRY_MESSAGE,
				{ title: m.admin_requests_toast_revoke_failed() }
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
			toast.success(
				decision === 'approve'
					? m.admin_requests_toast_doc_approved({ name: doc.name })
					: m.admin_requests_toast_doc_rejected({ name: doc.name })
			);
			rejectingDoc = null;
			rejectDocReason = '';
			await load();
		} else {
			toast.error(
				result.error.code === 'INVALID_KYC_DOCUMENT' && decision === 'reject'
					? m.admin_requests_error_doc_reject_reason()
					: RETRY_MESSAGE,
				{
					title:
						decision === 'approve'
							? m.admin_requests_toast_doc_not_approved({ name: doc.name })
							: m.admin_requests_toast_doc_not_rejected({ name: doc.name })
				}
			);
		}
		reviewingIds.delete(doc.id);
	}

	/** The safety-gate document lives on the verification record; it opens in
	 * the same viewer from a short-lived link (UAT #29), read-only — its dates
	 * are decided with the verification. */
	type SafetyDocView = {
		name: string;
		status: ChipStatus;
		url: string;
		filename: string;
		expiryDate: string | null;
	};
	let safetyDoc = $state<SafetyDocView | null>(null);
	let safetyDocLoading = $state(false);

	async function openSafetyDocument(
		verificationId: string,
		doc: { name: string; status: ChipStatus; expiryDate: string | null }
	) {
		safetyDocLoading = true;
		const result = await getSafetyDocumentFileUrl(verificationId);
		safetyDocLoading = false;
		if (result.ok) {
			safetyDoc = { ...doc, url: result.data.url, filename: result.data.filename ?? '' };
		} else {
			toast.error(RETRY_MESSAGE, { title: m.admin_requests_toast_open_failed() });
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
					? m.admin_requests_doc_no_file()
					: RETRY_MESSAGE,
				{ title: m.admin_requests_toast_open_failed() }
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
		if (status === 'expired') return 'expired';
		return 'submitted';
	}
</script>

<svelte:head>
	<title
		>{m.admin_requests_detail_page_title({
			name: applicantName || m.admin_requests_detail_review_fallback()
		})}</title
	>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/admin/approval-requests')} class="font-semibold text-primary">
			{m.admin_requests_heading()}
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
						{detail.approvalRequest.status === 'submitted'
							? m.admin_requests_detail_meta_waiting({
									email: detail.user.email,
									role: userRoleLabel(detail.user.role),
									date: formatDate(detail.approvalRequest.createdAt),
									duration: waitingText(detail.approvalRequest.createdAt)
								})
							: m.admin_requests_detail_meta({
									email: detail.user.email,
									role: userRoleLabel(detail.user.role),
									date: formatDate(detail.approvalRequest.createdAt)
								})}
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
						{m.admin_requests_reject_button()}
					</button>
					<button
						type="button"
						class="btn btn-primary"
						onclick={openApprove}
						disabled={blockers.length > 0}
						title={blockers.length > 0 ? m.admin_requests_resolve_first() : undefined}
					>
						{m.admin_requests_approve_button()}
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
					{m.admin_requests_current_approval({
						expires: formatDate(detail.currentApproval.expiresAt),
						granted: formatDate(detail.currentApproval.grantedAt)
					})}
				</span>
				<button
					type="button"
					class="btn btn-outline btn-sm btn-error"
					onclick={() => (revokeOpen = true)}
				>
					{m.admin_requests_revoke_button()}
				</button>
			</div>
		{/if}

		{#if detail.approvalRequest.status === 'rejected' && detail.approvalRequest.reason}
			<p
				class="mt-4 max-w-2xl rounded-md border border-error-content bg-error-content/40 px-3.5
					py-2.5 text-[12.5px] leading-relaxed text-error"
			>
				<b>{m.admin_requests_rejected_label()}</b>
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
					{m.admin_requests_blockers_heading()}
				</p>
				<ul class="mt-1.5 list-disc pl-5 text-[12.5px] text-error">
					{#each blockers as blocker (blocker.kind + ('documentTypeId' in blocker ? blocker.documentTypeId : ''))}
						<li>{describeApprovalBlocker(blocker)}</li>
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
					{m.admin_requests_warning_banner({ count: warningCount, text: warningText })}
				</span>
			</div>
		{/if}

		<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
			<div class="flex flex-col gap-3.5">
				<!-- Profile -->
				<div class="rounded-lg border border-card-border bg-base-100 p-5">
					<div class="mb-3.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
						{m.admin_requests_profile_heading()}
					</div>
					<div class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
						<span class="text-outline">{m.admin_requests_field_name()}</span>
						<span class="font-medium text-base-content">{applicantName}</span>
						<span class="text-outline">{m.admin_requests_field_gender()}</span>
						<span class="font-medium text-base-content">
							{genderLabel(detail.profile.gender)}
						</span>
						<span class="text-outline">{m.admin_requests_field_dob()}</span>
						<span class="font-medium text-base-content">{detail.profile.dateOfBirth ?? '—'}</span>
						<span class="text-outline">{m.admin_requests_field_phone()}</span>
						<span class="font-medium text-base-content">{detail.profile.phoneNumber ?? '—'}</span>
						<span class="text-outline">{m.admin_requests_field_location()}</span>
						<span class="font-medium text-base-content">{location ?? '—'}</span>
						<span class="text-outline">{m.admin_requests_field_language()}</span>
						<span class="font-medium text-base-content"
							>{languageLabel(detail.profile.language)}</span
						>
					</div>
					{#if detail.profile.shortBio}
						<div class="mt-3.5 border-t border-base-300 pt-3.5">
							<span class="mb-1 block text-[11.5px] text-outline"
								>{m.admin_requests_field_short_bio()}</span
							>
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
							{m.admin_requests_services_needed({ count: detail.servicesNeeded.length })}
						</div>
						{#if detail.servicesNeeded.length === 0}
							<p class="py-2 text-[13px] text-base-content-muted">{m.admin_requests_no_needs()}</p>
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
							{m.admin_requests_services_offered({ count: detail.servicesOffered.length })}
						</div>
						{#if detail.servicesOffered.length === 0}
							<p class="py-2 text-[13px] text-warning">{m.admin_requests_no_services()}</p>
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
										{formatMoney(service.hourlyRateCents)}<span
											class="text-[11px] font-normal text-outline"
											>{m.admin_requests_rate_unit()}</span
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
						{m.admin_requests_documents_heading({
							submitted: requiredSubmitted,
							total: requiredDocs.length
						})}
					</span>
				</div>
				<div class="flex flex-col gap-2.5">
					{#each [...requiredDocs, ...optionalDocs] as doc (doc.documentTypeId)}
						{@const canOpen = !!doc.document && doc.document.source !== 'credibled'}
						{@const canDecide = !!doc.document && doc.status === 'submitted'}
						{@const canRevoke =
							!!doc.document &&
							!doc.isSafetyGate &&
							(doc.status === 'approved' || doc.status === 'expired')}
						<div
							class="flex flex-col gap-3 rounded-[10px] border p-3.5
								{doc.status === 'missing'
								? 'border-dashed border-warning-border bg-warning-content/30'
								: 'border-card-border bg-base-100'}"
						>
							<div class="flex items-start gap-3">
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
											<span class="ml-1 text-[10.5px] font-medium text-outline"
												>{m.admin_requests_doc_optional()}</span
											>
										{/if}
									</div>
									<div
										class="truncate text-[11.5px]
										{doc.status === 'missing' ? 'text-warning' : 'text-base-content-muted'}"
									>
										{#if doc.document}
											{#if doc.document.source === 'credibled'}
												{m.admin_requests_doc_credibled()}
											{:else}
												{doc.document.filename}
											{/if}
											{#if doc.document.expiryDate}
												{m.admin_requests_doc_expires({
													date: formatCalendarDate(doc.document.expiryDate)
												})}
											{/if}
										{:else}
											{m.admin_requests_doc_not_submitted()}
										{/if}
									</div>
								</div>
								<StatusChip status={docChip(doc.status)} />
							</div>
							{#if canOpen || canDecide || canRevoke}
								<div class="flex flex-wrap items-center justify-end gap-2">
									<!-- A fetched document has no file of ours to open. -->
									{#if canOpen && doc.document}
										<button
											type="button"
											class="btn btn-outline btn-xs"
											onclick={() =>
												void (doc.isSafetyGate
													? openSafetyDocument(doc.document!.id, {
															name: doc.name,
															status: docChip(doc.status),
															expiryDate: doc.document!.expiryDate
														})
													: openViewer(doc.document!.id))}
										>
											{m.admin_requests_view_file()}
										</button>
									{/if}
									{#if doc.document && doc.status === 'submitted'}
										{#if doc.isSafetyGate}
											<!-- The gate's verdict is decided with the verification itself. -->
											<a href={resolve('/admin/safety-verifications')} class="btn btn-ghost btn-xs">
												{m.admin_requests_decide_in_safety()}
											</a>
										{:else}
											{@const ref = { id: doc.document.id, name: doc.name }}
											<button
												type="button"
												class="btn btn-primary btn-xs"
												disabled={reviewingIds.has(ref.id)}
												onclick={() => void reviewDocument(ref, 'approve')}
											>
												{m.admin_requests_doc_approve()}
											</button>
											<button
												type="button"
												class="btn btn-outline btn-error btn-xs"
												disabled={reviewingIds.has(ref.id)}
												onclick={() => (rejectingDoc = ref)}
											>
												{m.admin_requests_doc_reject()}
											</button>
										{/if}
									{:else if doc.document && !doc.isSafetyGate && (doc.status === 'approved' || doc.status === 'expired')}
										<!-- An approved document can still be withdrawn (R9): the same
								     rejection with a reason the applicant sees. -->
										{@const ref = { id: doc.document.id, name: doc.name }}
										<button
											type="button"
											class="btn btn-outline btn-error btn-xs"
											disabled={reviewingIds.has(ref.id)}
											onclick={() => (rejectingDoc = ref)}
										>
											{m.admin_requests_doc_revoke()}
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<p
					class="mt-3.5 flex items-center gap-2 border-t border-base-300 pt-3.5 text-xs text-outline"
				>
					<i class="las la-info-circle text-sm" aria-hidden="true"></i>
					{m.admin_requests_docs_footnote()}
				</p>
			</div>
		</div>
	{/if}
</div>

<ApproveRequestDialog
	open={approveOpen && detail !== null}
	{applicantName}
	blockers={blockers.map((blocker) => describeApprovalBlocker(blocker))}
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

<DocumentViewerFrame
	url={safetyDoc?.url ?? null}
	title={safetyDoc?.name ?? ''}
	filename={safetyDoc?.filename ?? ''}
	status={safetyDoc ? { status: safetyDoc.status } : undefined}
	loading={safetyDocLoading}
	onclose={() => (safetyDoc = null)}
>
	{#snippet sidebar()}
		{#if safetyDoc}
			<div class="mb-3.5 text-[10.5px] font-semibold tracking-[0.1em] text-neutral uppercase">
				{m.admin_requests_viewer_details()}
			</div>
			<div class="grid grid-cols-[90px_1fr] gap-x-2.5 gap-y-2 text-[12.5px]">
				<span class="text-outline">{m.admin_requests_viewer_type()}</span>
				<span class="font-medium text-base-content">{safetyDoc.name}</span>
				<span class="text-outline">{m.admin_requests_viewer_file()}</span>
				<span class="truncate font-medium text-base-content">{safetyDoc.filename}</span>
				<span class="text-outline">{m.admin_safety_viewer_valid_until()}</span>
				<span class="font-medium text-base-content">
					{safetyDoc.expiryDate ? formatCalendarDate(safetyDoc.expiryDate) : '—'}
				</span>
			</div>
		{/if}
	{/snippet}
</DocumentViewerFrame>

<DocumentViewerDialog
	{viewer}
	loading={viewerLoading}
	onclose={closeViewer}
	onsaved={() => void load()}
/>

{#if rejectingDoc}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.admin_requests_reject_doc_aria()}
	>
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.admin_requests_reject_doc_title({ name: rejectingDoc.name })}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{m.admin_requests_reject_doc_body()}
			</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectDocReason}
				placeholder={m.admin_requests_reject_doc_placeholder()}
			></textarea>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (rejectingDoc = null)}>
					{m.common_cancel()}
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectDocReason.trim().length === 0 || reviewingIds.has(rejectingDoc.id)}
					onclick={() =>
						rejectingDoc && void reviewDocument(rejectingDoc, 'reject', rejectDocReason.trim())}
				>
					{m.admin_requests_doc_reject()}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			aria-label={m.common_close()}
			onclick={() => (rejectingDoc = null)}
		></button>
	</div>
{/if}
