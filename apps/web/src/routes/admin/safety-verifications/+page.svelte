<script lang="ts">
	/** Admin review queue for safety verifications. Nothing here auto-approves —
	 * a Credibled PASS makes a record eligible, a person decides. */
	import { onMount } from 'svelte';
	import {
		decideSafetyVerification,
		listSafetyVerificationsForReview,
		safetyVerificationReportUrl,
		type AdminSafetyVerification
	} from '$lib/api/safety-verification';
	import { getSafetyDocumentFileUrl } from '$lib/api/admin-approvals';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import DocumentViewerFrame from '$lib/components/admin/DocumentViewerFrame.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatCalendarDate, formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = m.admin_safety_error_retry();

	type Outcome = NonNullable<AdminSafetyVerification['credibledResult']>['outcome'];

	// Credibled's own conclusion. It informs the decision; it never makes it.
	const outcomeChips: Record<Outcome, { status: ChipStatus; label: string }> = {
		cleared: { status: 'approved', label: m.admin_safety_outcome_cleared() },
		not_cleared: { status: 'rejected', label: m.admin_safety_outcome_not_cleared() },
		inconclusive: { status: 'missing', label: m.admin_safety_outcome_inconclusive() }
	};

	let items: Array<AdminSafetyVerification> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	const busyIds = new SvelteSet<string>();

	// Approve is confirmed first (UAT #29) — it makes the person discoverable.
	let approving = $state<AdminSafetyVerification | null>(null);

	let rejecting: AdminSafetyVerification | null = $state<AdminSafetyVerification | null>(null);
	let rejectReason = $state('');
	let rejectBusy = $state(false);

	async function load() {
		loading = true;
		const result = await listSafetyVerificationsForReview();
		if (result.ok) {
			items = result.data.verifications;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN' ? m.admin_safety_error_forbidden() : RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	const personLabel = (item: AdminSafetyVerification) =>
		item.applicant.name ?? item.applicant.email ?? m.admin_safety_unnamed_applicant();

	// The uploaded file opens in the same in-browser viewer as approval requests.
	let viewing = $state<{
		item: AdminSafetyVerification;
		url: string;
		filename: string;
		report?: boolean;
	} | null>(null);
	let viewerLoading = $state(false);

	async function openFile(item: AdminSafetyVerification) {
		viewerLoading = true;
		const result = await getSafetyDocumentFileUrl(item.id);
		viewerLoading = false;
		if (result.ok) {
			viewing = { item, url: result.data.url, filename: result.data.filename ?? '' };
		} else {
			toast.error(RETRY_MESSAGE, { title: m.admin_safety_toast_open_failed() });
		}
	}

	async function approve(item: AdminSafetyVerification) {
		approving = null;
		busyIds.add(item.id);
		const result = await decideSafetyVerification(item.id, { decision: 'approve' });
		if (result.ok) {
			toast.success(m.admin_safety_toast_approved());
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: m.admin_safety_toast_not_approved() });
		}
		busyIds.delete(item.id);
	}

	async function confirmReject() {
		if (!rejecting || rejectBusy || rejectReason.trim().length === 0) return;
		rejectBusy = true;
		const result = await decideSafetyVerification(rejecting.id, {
			decision: 'reject',
			reason: rejectReason.trim()
		});
		if (result.ok) {
			toast.success(m.admin_safety_toast_rejected());
			rejecting = null;
			rejectReason = '';
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: m.admin_safety_toast_not_rejected() });
		}
		rejectBusy = false;
	}
</script>

<svelte:head><title>{m.admin_safety_page_title()}</title></svelte:head>

<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.admin_safety_heading()}</h1>
<p class="mt-1 mb-5 text-sm text-base-content-muted">
	{m.admin_safety_intro()}
</p>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">{m.admin_safety_empty_title()}</p>
		<p class="text-sm text-base-content-muted">{m.admin_safety_empty_body()}</p>
	</div>
{:else}
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const busy = busyIds.has(item.id)}
			<div class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5">
				<div class="flex flex-wrap items-center gap-3">
					<StatusChip
						status={item.route === 'credibled' ? 'in-progress' : 'submitted'}
						label={item.route === 'credibled'
							? m.admin_safety_route_credibled()
							: m.admin_safety_route_document()}
					/>
					<span class="text-sm font-semibold text-base-content">{personLabel(item)}</span>
					<span class="text-xs text-base-content-muted">
						{item.role === 'family' ? m.admin_safety_role_family() : m.admin_safety_role_helper()}
						{#if item.applicant.name && item.applicant.email}· {item.applicant.email}{/if}
					</span>
					<span class="text-xs font-medium text-base-content">{item.documentTypeName}</span>
					{#if item.credibledResult}
						<StatusChip {...outcomeChips[item.credibledResult.outcome]} />
					{/if}
				</div>

				{#if item.credibledResult && item.credibledResult.checks.length > 0}
					<ul class="mt-2 flex flex-col gap-1 text-xs text-base-content-muted">
						{#each item.credibledResult.checks as check (check.label)}
							<li class="flex flex-wrap items-center gap-2">
								<span class="font-medium text-base-content">{check.label}</span>
								{#if check.outcome}
									<StatusChip {...outcomeChips[check.outcome]} />
								{/if}
								{#if check.score}<span>{m.admin_safety_score({ score: check.score })}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}

				<dl class="mt-2 grid gap-x-6 gap-y-1 text-xs text-base-content-muted sm:grid-cols-2">
					{#if item.issuingAuthority}
						<div>
							<dt class="inline font-medium">{m.admin_safety_issuer()}</dt>
							<dd class="inline">{item.issuingAuthority}</dd>
						</div>
					{/if}
					{#if item.documentNumber}
						<div>
							<dt class="inline font-medium">{m.admin_safety_number()}</dt>
							<dd class="inline">{item.documentNumber}</dd>
						</div>
					{/if}
					{#if item.issuedOn}
						<div>
							<dt class="inline font-medium">{m.admin_safety_issued()}</dt>
							<dd class="inline">{formatCalendarDate(item.issuedOn)}</dd>
						</div>
					{/if}
					{#if item.expiresOn}
						<div>
							<dt class="inline font-medium">{m.admin_safety_valid_until()}</dt>
							<dd class="inline">{formatCalendarDate(item.expiresOn)}</dd>
						</div>
					{/if}
					{#if item.consentAt}
						<div>
							<dt class="inline font-medium">{m.admin_safety_consent()}</dt>
							<dd class="inline">
								{m.admin_safety_consent_value({
									date: formatDateTime(item.consentAt),
									version: item.consentPolicyVersion ?? '—'
								})}
							</dd>
						</div>
					{/if}
				</dl>

				<div class="mt-3 flex flex-wrap gap-2">
					{#if item.hasFile}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							onclick={() => void openFile(item)}
						>
							{m.admin_safety_view_file()}
						</button>
					{/if}
					{#if item.hasCredibledCheck}
						<button
							type="button"
							class="btn btn-outline btn-sm"
							onclick={() =>
								(viewing = {
									item,
									url: safetyVerificationReportUrl(item.id),
									filename: `safety-verification-${item.id}.pdf`,
									report: true
								})}
						>
							{m.admin_safety_open_report()}
						</button>
					{/if}
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={busy}
						onclick={() => (approving = item)}
					>
						{m.admin_safety_approve_button()}
					</button>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						disabled={busy}
						onclick={() => (rejecting = item)}
					>
						{m.admin_safety_reject_button()}
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if rejecting}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.admin_safety_reject_title()}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{m.admin_safety_reject_body()}
			</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectReason}
				placeholder={m.admin_safety_reject_placeholder()}
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					onclick={() => (rejecting = null)}
					disabled={rejectBusy}
				>
					{m.common_cancel()}
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectBusy || rejectReason.trim().length === 0}
					onclick={confirmReject}
				>
					{#if rejectBusy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{m.admin_safety_reject_button()}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (rejecting = null)}
			aria-label={m.common_close()}
		></button>
	</div>
{/if}

<ConfirmDialog
	open={approving !== null}
	title={m.admin_safety_approve_title()}
	body={approving
		? m.admin_safety_approve_body({
				person: personLabel(approving),
				document: approving.documentTypeName
			})
		: ''}
	confirmLabel={m.admin_safety_approve_confirm()}
	confirmClass="btn-primary"
	onconfirm={() => approving && void approve(approving)}
	oncancel={() => (approving = null)}
/>

<DocumentViewerFrame
	url={viewing?.url ?? null}
	title={viewing?.item.documentTypeName ?? ''}
	filename={viewing?.filename ?? ''}
	pdf={viewing?.report ?? false}
	status={{ status: 'submitted' }}
	loading={viewerLoading}
	onclose={() => (viewing = null)}
>
	{#snippet sidebar()}
		{#if viewing}
			{@const item = viewing.item}
			<div class="mb-3.5 text-[10.5px] font-semibold tracking-[0.1em] text-neutral uppercase">
				{m.admin_requests_viewer_details()}
			</div>
			<div class="grid grid-cols-[90px_1fr] gap-x-2.5 gap-y-2 text-[12.5px]">
				<span class="text-outline">{m.admin_safety_viewer_person()}</span>
				<span class="font-medium text-base-content">{personLabel(item)}</span>
				<span class="text-outline">{m.admin_requests_viewer_type()}</span>
				<span class="font-medium text-base-content">{item.documentTypeName}</span>
				<span class="text-outline">{m.admin_requests_viewer_file()}</span>
				<span class="truncate font-medium text-base-content">{viewing.filename}</span>
				{#if item.issuingAuthority}
					<span class="text-outline">{m.admin_safety_viewer_issuer()}</span>
					<span class="font-medium text-base-content">{item.issuingAuthority}</span>
				{/if}
				{#if item.documentNumber}
					<span class="text-outline">{m.admin_safety_viewer_number()}</span>
					<span class="font-medium text-base-content">{item.documentNumber}</span>
				{/if}
				<span class="text-outline">{m.admin_requests_viewer_issued()}</span>
				<span class="font-medium text-base-content">
					{item.issuedOn ? formatCalendarDate(item.issuedOn) : '—'}
				</span>
				<span class="text-outline">{m.admin_safety_viewer_valid_until()}</span>
				<span class="font-medium text-base-content">
					{item.expiresOn ? formatCalendarDate(item.expiresOn) : '—'}
				</span>
			</div>
		{/if}
	{/snippet}
</DocumentViewerFrame>
