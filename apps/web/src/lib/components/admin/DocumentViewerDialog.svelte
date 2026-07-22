<script lang="ts">
	/** Fullscreen PII-safe document viewer (design 8b): view in-browser only,
	 * edit the expiry date in the sidebar. Shows a loading modal while the
	 * signed URL is fetched; owns the expiry-save flow and calls `onsaved`
	 * so the parent can refresh its data. */
	import {
		updateKycDocumentExpiry,
		type KycFileView
	} from '$lib/api/admin-approvals';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	interface Props {
		viewer: KycFileView | null;
		loading?: boolean;
		onclose: () => void;
		onsaved: () => void;
	}

	let { viewer, loading = false, onclose, onsaved }: Props = $props();

	let expiry = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let saved = $state(false);

	$effect(() => {
		if (viewer) {
			expiry = viewer.document.expiryDate ? viewer.document.expiryDate.slice(0, 10) : '';
			saveError = '';
			saved = false;
		}
	});

	const isPdf = $derived((viewer?.document.filename ?? '').toLowerCase().endsWith('.pdf'));

	function docChip(status: string): ChipStatus {
		if (status === 'approved') return 'approved';
		if (status === 'rejected') return 'rejected';
		if (status === 'missing') return 'missing';
		return 'submitted';
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-CA', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	async function saveExpiry(event: SubmitEvent) {
		event.preventDefault();
		if (!viewer || saving) return;
		saving = true;
		saveError = '';
		saved = false;
		const iso = expiry ? new Date(expiry).toISOString() : null;
		const result = await updateKycDocumentExpiry(viewer.document.id, iso);
		if (result.ok) {
			saved = true;
			onsaved();
		} else {
			saveError =
				result.error.code === 'INVALID_KYC_DOCUMENT' ? result.error.message : RETRY_MESSAGE;
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
		aria-label="Document viewer"
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
				aria-label="Close viewer"
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
						<input type="date" class="input w-full" bind:value={expiry} />
					</fieldset>
					<p class="mt-1.5 mb-3.5 text-[11.5px] leading-relaxed text-outline">
						Entered by the provider — correct it here if it doesn't match the file.
					</p>
					{#if saveError}
						<p role="alert" class="mb-2 text-xs font-medium text-error">{saveError}</p>
					{/if}
					{#if saved}
						<p class="mb-2 text-xs font-medium text-success">Expiry date saved.</p>
					{/if}
					<button type="submit" class="btn w-full btn-primary" disabled={saving}>
						{#if saving}
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
