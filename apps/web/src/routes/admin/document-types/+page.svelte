<script lang="ts">
	import {
		createDocumentType,
		listDocumentTypes,
		removeDocumentType,
		updateDocumentType,
		type DocumentType,
		type DocumentTypeDraft
	} from '$lib/api/document-types';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import DocumentTypeDialog from '$lib/components/admin/DocumentTypeDialog.svelte';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let items: Array<DocumentType> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	const busyIds = new SvelteSet<string>();

	// Create/edit modal
	let modalOpen = $state(false);
	let editing: DocumentType | null = $state(null);
	let saving = $state(false);
	let modalError: string | null = $state(null);

	// Delete confirmation
	let deleting: DocumentType | null = $state(null);
	let deleteBusy = $state(false);

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? 'Your account is not authorized to manage document types.'
			: error.code === 'UNAUTHORIZED'
				? 'Your session has expired — sign in again.'
				: RETRY_MESSAGE;

	async function load() {
		loading = true;
		const result = await listDocumentTypes();
		if (result.ok) {
			items = result.data;
			errorMessage = null;
		} else {
			errorMessage = errorText(result.error);
		}
		loading = false;
	}

	$effect(() => {
		void load();
	});

	function openCreate() {
		editing = null;
		modalError = null;
		modalOpen = true;
	}

	function openEdit(item: DocumentType) {
		editing = item;
		modalError = null;
		modalOpen = true;
	}

	async function save(draft: DocumentTypeDraft) {
		if (saving) return;
		saving = true;
		modalError = null;
		const result = editing
			? await updateDocumentType(editing.id, draft)
			: await createDocumentType(draft);
		if (result.ok) {
			modalOpen = false;
			toast.success(editing ? `${result.data.name} updated.` : `${result.data.name} created.`);
			await load();
		} else if (result.error.code === 'INVALID_KYC_DOCUMENT_TYPE_INPUT') {
			// Field validation stays next to the input inside the dialog.
			modalError = 'Check the name — it must be 1–120 characters.';
		} else {
			toast.error(errorText(result.error), {
				title: editing ? 'Document type not updated' : 'Document type not created'
			});
		}
		saving = false;
	}

	/** Inline toggle: pessimistic — the row is disabled while the PATCH is in
	 * flight and the checkbox is reverted if it fails. */
	async function toggleField(
		item: DocumentType,
		field: 'isOptional' | 'requiresExpiryDate' | 'isFetchable',
		input: HTMLInputElement
	) {
		const value = input.checked;
		// "Required" is the inverse of isOptional: the toggle shows Required.
		const patchValue = field === 'isOptional' ? !value : value;
		busyIds.add(item.id);
		const result = await updateDocumentType(item.id, { [field]: patchValue });
		if (result.ok) {
			items = items.map((candidate) => (candidate.id === item.id ? result.data : candidate));
			const updated = result.data;
			toast.success(
				field === 'isOptional'
					? `${updated.name} is now ${updated.isOptional ? 'optional' : 'required'}.`
					: field === 'requiresExpiryDate'
						? `${updated.name} ${updated.requiresExpiryDate ? 'now requires' : 'no longer requires'} an expiry date.`
						: `${updated.name} is now ${updated.isFetchable ? 'fetchable via Credibled' : 'upload only'}.`
			);
		} else {
			input.checked = !value;
			toast.error(errorText(result.error), { title: `${item.name} not updated` });
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeDocumentType(deleting.id);
		if (result.ok) {
			toast.success(`${deleting.name} deleted.`);
			deleting = null;
			await load();
		} else {
			toast.error(errorText(result.error), { title: `${deleting.name} not deleted` });
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>Document types · Poppynz admin</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			Document types
		</h1>
		<p class="text-sm text-base-content-muted">
			The checklist every provider sees during onboarding. Changes apply to new uploads
			immediately.
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={openCreate}>
		<i class="las la-plus" aria-hidden="true"></i>
		New type
	</button>
</div>

{#if errorMessage}
	<p
		class="mb-5 flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content px-4
			py-3 text-sm font-medium text-error"
		role="alert"
	>
		<i class="las la-exclamation-circle text-base" aria-hidden="true"></i>
		{errorMessage}
	</p>
{/if}

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">No document types yet</p>
		<p class="text-sm text-base-content-muted">
			Create the first type — it appears on every provider's checklist immediately.
		</p>
	</div>
{:else}
	<!-- Desktop: header row + card rows (per design 8d) -->
	<div
		class="mb-2 hidden grid-cols-[1fr_150px_130px_130px_140px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>Name</span><span>Applies to</span><span>Requirement</span><span>Expiry date</span>
		<span>Credibled</span><span class="text-right">Actions</span>
	</div>
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const busy = busyIds.has(item.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[1fr_150px_130px_130px_140px_90px] lg:items-center lg:gap-3.5"
			>
				<div class="mb-2 flex items-center justify-between lg:mb-0 lg:block">
					<span class="text-sm font-semibold text-base-content">{item.name}</span>
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info lg:hidden">
						{item.isOptional ? 'Optional' : 'Required'}
					</span>
				</div>
				<div class="hidden lg:block">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						Service provider
					</span>
				</div>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<input
						type="checkbox"
						class="toggle toggle-sm toggle-primary"
						checked={!item.isOptional}
						disabled={busy}
						onchange={(event) => toggleField(item, 'isOptional', event.currentTarget)}
					/>
					<span class="text-xs text-base-content-muted">
						{item.isOptional ? 'Optional' : 'Required'}
					</span>
				</label>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<input
						type="checkbox"
						class="toggle toggle-sm toggle-primary"
						checked={item.requiresExpiryDate}
						disabled={busy}
						onchange={(event) => toggleField(item, 'requiresExpiryDate', event.currentTarget)}
					/>
					<span class="text-xs text-base-content-muted">Expiry</span>
				</label>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<input
						type="checkbox"
						class="toggle toggle-sm toggle-credibled"
						checked={item.isFetchable}
						disabled={busy}
						onchange={(event) => toggleField(item, 'isFetchable', event.currentTarget)}
					/>
					<span class="text-xs text-base-content-muted">
						{item.isFetchable ? 'Fetchable' : 'Upload only'}
					</span>
				</label>
				<div class="mt-2 flex justify-end gap-1.5 lg:mt-0">
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label="Edit {item.name}"
						onclick={() => openEdit(item)}
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label="Delete {item.name}"
						onclick={() => (deleting = item)}
					>
						<i class="las la-trash-alt text-base" aria-hidden="true"></i>
					</button>
				</div>
			</div>
		{/each}
	</div>

	<p
		class="mt-4 flex max-w-2xl items-center gap-2.5 rounded-md border border-base-500 bg-base-400
			px-4 py-3 text-xs text-info"
	>
		<i class="las la-info-circle text-base" aria-hidden="true"></i>
		Deleting a type is a soft delete — existing submitted documents keep their history. This list
		directly shapes the provider's upload step.
	</p>
{/if}

<DocumentTypeDialog
	open={modalOpen}
	{editing}
	busy={saving}
	error={modalError}
	onsave={(draft) => void save(draft)}
	oncancel={() => (modalOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title="Delete {deleting?.name}?"
	body="This is a soft delete — documents already submitted for this type keep their history, but providers won't see it on their checklist anymore."
	busy={deleteBusy}
	onconfirm={confirmDelete}
	oncancel={() => (deleting = null)}
/>
