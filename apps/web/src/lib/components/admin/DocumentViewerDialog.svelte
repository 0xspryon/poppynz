<script lang="ts">
	import { formatCalendarDate, formatDate as formatInstant } from '$lib/date';
	/** Fullscreen PII-safe document viewer (design 8b): view in-browser only,
	 * edit the expiry date in the sidebar. Shows a loading modal while the
	 * signed URL is fetched; owns the expiry-save flow and calls `onsaved`
	 * so the parent can refresh its data. */
	import { updateKycDocumentExpiry, type KycFileView } from '$lib/api/admin-approvals';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		viewer: KycFileView | null;
		loading?: boolean;
		onclose: () => void;
		onsaved: () => void;
	}

	let { viewer, loading = false, onclose, onsaved }: Props = $props();

	let expiry = $state('');
	let saving = $state(false);

	$effect(() => {
		if (viewer) {
			expiry = viewer.document.expiryDate ? viewer.document.expiryDate.slice(0, 10) : '';
		}
	});

	const isPdf = $derived((viewer?.document.filename ?? '').toLowerCase().endsWith('.pdf'));

	function docChip(status: string): ChipStatus {
		if (status === 'approved') return 'approved';
		if (status === 'rejected') return 'rejected';
		if (status === 'missing') return 'missing';
		if (status === 'expired') return 'expired';
		return 'submitted';
	}

	// Document dates are calendar dates — never shifted by the viewer's zone (UAT #28).
	function formatDate(iso: string | null): string {
		return iso ? formatCalendarDate(iso) : '—';
	}

	async function saveExpiry(event: SubmitEvent) {
		event.preventDefault();
		if (!viewer || saving) return;
		saving = true;
		const iso = expiry ? new Date(expiry).toISOString() : null;
		const result = await updateKycDocumentExpiry(viewer.document.id, iso);
		if (result.ok) {
			toast.success(m.admin_requests_viewer_saved());
			onsaved();
		} else {
			toast.error(
				result.error.code === 'INVALID_KYC_DOCUMENT'
					? m.admin_requests_viewer_invalid_expiry()
					: m.common_error_generic(),
				{ title: m.admin_requests_viewer_not_saved() }
			);
		}
		saving = false;
	}
</script>

{#if loading}
	<div class="modal modal-open">
		<div class="modal-box flex w-40 items-center justify-center">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	</div>
{:else if viewer}
	<div
		class="fixed inset-0 z-50 flex flex-col bg-secondary"
		role="dialog"
		aria-label={m.admin_requests_viewer_aria()}
	>
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
				aria-label={m.admin_requests_viewer_close()}
				onclick={onclose}
			>
				<i class="las la-times text-lg" aria-hidden="true"></i>
			</button>
		</header>
		<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
			<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
				{#if isPdf}
					<iframe
						src={viewer.url}
						title={m.admin_requests_viewer_preview()}
						class="h-full w-full rounded-md bg-base-100"
					></iframe>
				{:else}
					<img
						src={viewer.url}
						alt={m.admin_requests_viewer_preview()}
						class="max-h-full max-w-full rounded-md shadow-panel"
					/>
				{/if}
			</div>
			<aside
				class="w-full shrink-0 overflow-y-auto border-t border-secondary-content/10 bg-base-100
					p-5 lg:w-80 lg:border-t-0 lg:border-l lg:border-card-border"
			>
				<div class="mb-3.5 text-[10.5px] font-semibold tracking-[0.1em] text-neutral uppercase">
					{m.admin_requests_viewer_details()}
				</div>
				<div class="mb-5 grid grid-cols-[90px_1fr] gap-x-2.5 gap-y-2 text-[12.5px]">
					<span class="text-outline">{m.admin_requests_viewer_type()}</span>
					<span class="font-medium text-base-content">{viewer.documentType.name}</span>
					<span class="text-outline">{m.admin_requests_viewer_file()}</span>
					<span class="truncate font-medium text-base-content">{viewer.document.filename}</span>
					<span class="text-outline">{m.admin_requests_viewer_submitted()}</span>
					<span class="font-medium text-base-content">
						{formatInstant(viewer.document.submittedAt)}
					</span>
					<span class="text-outline">{m.admin_requests_viewer_issued()}</span>
					<span class="font-medium text-base-content">
						{formatDate(viewer.document.issuedOn)}
					</span>
				</div>

				<form onsubmit={saveExpiry}>
					<fieldset class="fieldset">
						<legend class="fieldset-legend">{m.admin_requests_viewer_expiry_label()}</legend>
						<input type="date" class="input w-full" bind:value={expiry} />
					</fieldset>
					<p class="mt-1.5 mb-3.5 text-[11.5px] leading-relaxed text-outline">
						{viewer.document.expiryDate
							? m.admin_requests_viewer_expiry_entered()
							: m.admin_requests_viewer_expiry_none()}
					</p>
					<button type="submit" class="btn w-full btn-primary" disabled={saving}>
						{#if saving}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						{m.admin_requests_viewer_save()}
					</button>
				</form>

				<div
					class="mt-6 flex items-start gap-2.5 rounded-[9px] border border-info-content
						bg-base-200 p-3"
				>
					<i class="las la-shield-alt mt-0.5 text-base text-info" aria-hidden="true"></i>
					<span class="text-[11.5px] leading-relaxed text-info">
						{m.admin_requests_viewer_pii()}
					</span>
				</div>
			</aside>
		</div>
	</div>
{/if}
