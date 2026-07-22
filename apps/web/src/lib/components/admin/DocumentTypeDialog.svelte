<script lang="ts">
	/** Create/edit dialog for KYC document types (design 8d). Owns the draft;
	 * emits it on save. */
	import type { DocumentType, DocumentTypeDraft } from '$lib/api/document-types';

	interface Props {
		open: boolean;
		/** The type being edited, or null when creating. */
		editing: DocumentType | null;
		busy?: boolean;
		error?: string | null;
		onsave: (draft: DocumentTypeDraft) => void;
		oncancel: () => void;
	}

	let { open, editing, busy = false, error = null, onsave, oncancel }: Props = $props();

	let draft: DocumentTypeDraft = $state({
		name: '',
		isOptional: false,
		requiresExpiryDate: true,
		isFetchable: false
	});

	$effect(() => {
		if (open) {
			draft = editing
				? {
						name: editing.name,
						isOptional: editing.isOptional,
						requiresExpiryDate: editing.requiresExpiryDate,
						isFetchable: editing.isFetchable
					}
				: { name: '', isOptional: false, requiresExpiryDate: true, isFetchable: false };
		}
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !draft.name.trim()) return;
		onsave(draft);
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<form class="modal-box max-w-lg border border-card-border" onsubmit={submit}>
			<h3 class="font-display text-xl font-bold text-base-content">
				{editing ? 'Edit document type' : 'New document type'}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{editing
					? 'Changes apply to new uploads immediately.'
					: "Added to every provider's checklist immediately."}
			</p>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Name · ≤120</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						required
						placeholder="Vulnerable-sector check"
						bind:value={draft.name}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Applies to</legend>
					<select class="select w-full" disabled>
						<option>Service provider</option>
					</select>
				</fieldset>
			</div>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
				<label class="flex items-center gap-2.5">
					<input
						type="checkbox"
						class="toggle toggle-primary"
						checked={!draft.isOptional}
						onchange={(event) => (draft.isOptional = !event.currentTarget.checked)}
					/>
					<span class="text-sm font-medium text-base-content">Required</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input
						type="checkbox"
						class="toggle toggle-primary"
						bind:checked={draft.requiresExpiryDate}
					/>
					<span class="text-sm font-medium text-base-content">Needs expiry date</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-credibled" bind:checked={draft.isFetchable} />
					<span class="text-sm font-medium text-base-content">Fetchable via Credibled</span>
				</label>
			</div>

			{#if error}
				<p class="mt-4 text-sm font-medium text-error" role="alert">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !draft.name.trim()}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{editing ? 'Save changes' : 'Create type'}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label="Close"></button>
	</div>
{/if}
