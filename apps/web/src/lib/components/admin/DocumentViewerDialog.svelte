<script lang="ts">
	import { formatCalendarDate, formatDate as formatInstant } from '$lib/date';
	/** An approval request's document in the shared viewer frame, with its
	 * expiry date editable in the sidebar. Owns the expiry-save flow and calls
	 * `onsaved` so the parent can refresh its data. */
	import { updateKycDocumentExpiry, type KycFileView } from '$lib/api/admin-approvals';
	import DocumentViewerFrame from '$lib/components/admin/DocumentViewerFrame.svelte';
	import type { ChipStatus } from '$lib/components/StatusChip.svelte';
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

<DocumentViewerFrame
	url={viewer?.url ?? null}
	title={viewer?.documentType.name ?? ''}
	filename={viewer?.document.filename ?? ''}
	status={viewer ? { status: docChip(viewer.document.status) } : undefined}
	{loading}
	{onclose}
>
	{#snippet sidebar()}
		{#if viewer}
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
		{/if}
	{/snippet}
</DocumentViewerFrame>
