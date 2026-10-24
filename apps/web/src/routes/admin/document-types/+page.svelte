<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createDocumentType,
		listDocumentTypes,
		removeDocumentType,
		updateDocumentType,
		type DocumentType,
		type DocumentTypeDraft
	} from '$lib/api/document-types';
	import {
		credibledCheckTypeLabel,
		credibledCheckTypes,
		type CredibledCheckTypeValue
	} from '@repo/credibled/check-types';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import DocumentTypeDialog from '$lib/components/admin/DocumentTypeDialog.svelte';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

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
			? m.admin_doctypes_error_forbidden()
			: error.code === 'UNAUTHORIZED'
				? m.admin_doctypes_error_session()
				: m.admin_doctypes_error_retry();

	/** The API's pricing invariant: a Credibled type needs a price, an
	 * upload-only type must not carry one. */
	const pricingErrorText = (checkType: string | null, costCents: number | null) =>
		checkType !== null && costCents === null
			? m.admin_doctypes_price_required()
			: m.admin_doctypes_price_not_allowed();

	/** A second safety gate for the role: name the type that already holds it. */
	const gateConflictText = (draft: DocumentTypeDraft) => {
		const holder = items.find(
			(item) =>
				item.isSafetyGate && item.appliesToRole === draft.appliesToRole && item.id !== editing?.id
		);
		return holder
			? m.admin_doctypes_gate_conflict_named({ name: holder.name })
			: m.admin_doctypes_gate_conflict();
	};

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

	onMount(() => {
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
			toast.success(
				editing
					? m.admin_doctypes_updated_toast({ name: result.data.name })
					: m.admin_doctypes_created_toast({ name: result.data.name })
			);
			await load();
		} else if (result.error.code === 'INVALID_KYC_DOCUMENT_TYPE_INPUT') {
			// Field validation stays next to the input inside the dialog.
			modalError = m.admin_doctypes_invalid_name();
		} else if (result.error.code === 'KYC_DOCUMENT_TYPE_CONFLICT') {
			// A second safety gate for the role: it belongs next to the toggles.
			modalError = gateConflictText(draft);
		} else if (result.error.code === 'INVALID_KYC_DOCUMENT') {
			// A pricing mismatch, also shown next to the fields.
			modalError = pricingErrorText(draft.credibledCheckTypeValue, draft.credibledCostCents);
		} else {
			toast.error(errorText(result.error), {
				title: editing ? m.admin_doctypes_not_updated_title() : m.admin_doctypes_not_created_title()
			});
		}
		saving = false;
	}

	/** Inline toggle: pessimistic — the row is disabled while the PATCH is in
	 * flight and the checkbox is reverted if it fails. */
	async function toggleField(
		item: DocumentType,
		field: 'isOptional' | 'requiresExpiryDate',
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
					? updated.isOptional
						? m.admin_doctypes_now_optional({ name: updated.name })
						: m.admin_doctypes_now_required({ name: updated.name })
					: updated.requiresExpiryDate
						? m.admin_doctypes_now_requires_expiry({ name: updated.name })
						: m.admin_doctypes_no_longer_requires_expiry({ name: updated.name })
			);
		} else {
			input.checked = !value;
			toast.error(errorText(result.error), {
				title: m.admin_doctypes_item_not_updated_title({ name: item.name })
			});
		}
		busyIds.delete(item.id);
	}

	/** Inline check-type picker: same pessimistic pattern as the toggles — the
	 * row is disabled while the PATCH is in flight and the select is reverted
	 * if it fails. */
	async function setCheckType(item: DocumentType, select: HTMLSelectElement) {
		const previous = item.credibledCheckTypeValue ?? '';
		const value = (select.value as CredibledCheckTypeValue) || null;
		busyIds.add(item.id);
		const result = await updateDocumentType(item.id, { credibledCheckTypeValue: value });
		if (result.ok) {
			items = items.map((candidate) => (candidate.id === item.id ? result.data : candidate));
			toast.success(
				value
					? m.admin_doctypes_now_collected_via({
							name: result.data.name,
							check: credibledCheckTypeLabel(value)
						})
					: m.admin_doctypes_now_upload_only({ name: result.data.name })
			);
		} else {
			select.value = previous;
			toast.error(
				// The API refuses a fetchable type with no price; say so instead of
				// the generic retry message, because retrying will not help.
				// `INVALID_KYC_DOCUMENT` is what the pricing invariant returns.
				result.error.code === 'INVALID_KYC_DOCUMENT'
					? pricingErrorText(value, item.credibledCostCents ?? null)
					: errorText(result.error),
				{ title: m.admin_doctypes_item_not_updated_title({ name: item.name }) }
			);
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeDocumentType(deleting.id);
		if (result.ok) {
			toast.success(m.admin_doctypes_deleted_toast({ name: deleting.name }));
			deleting = null;
			await load();
		} else {
			toast.error(errorText(result.error), {
				title: m.admin_doctypes_item_not_deleted_title({ name: deleting.name })
			});
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>{m.admin_doctypes_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.admin_doctypes_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.admin_doctypes_intro()}
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={openCreate}>
		<i class="las la-plus" aria-hidden="true"></i>
		{m.admin_doctypes_new()}
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
		<p class="mb-1 font-semibold text-base-content">{m.admin_doctypes_empty_title()}</p>
		<p class="text-sm text-base-content-muted">
			{m.admin_doctypes_empty_body()}
		</p>
	</div>
{:else}
	<!-- Desktop: header row + card rows (per design 8d) -->
	<div
		class="mb-2 hidden grid-cols-[1fr_140px_120px_110px_210px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>{m.admin_doctypes_col_name()}</span><span>{m.admin_doctypes_col_applies_to()}</span>
		<span>{m.admin_doctypes_col_requirement()}</span><span>{m.admin_doctypes_col_expiry()}</span>
		<span>{m.admin_doctypes_col_credibled()}</span><span class="text-right"
			>{m.admin_doctypes_col_actions()}</span
		>
	</div>
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const busy = busyIds.has(item.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[1fr_140px_120px_110px_210px_90px] lg:items-center lg:gap-3.5"
			>
				<div class="mb-2 flex items-center justify-between lg:mb-0 lg:block">
					<span class="text-sm font-semibold text-base-content">{item.name}</span>
					{#if item.isSafetyGate}
						<span
							class="badge badge-sm badge-primary ml-2 font-semibold"
							title={m.admin_doctypes_gate_title()}
						>
							{m.admin_doctypes_safety_gate()}
						</span>
					{/if}
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info lg:hidden">
						{item.isOptional ? m.common_optional() : m.common_required()}
					</span>
				</div>
				<div class="hidden lg:block">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						{item.appliesToRole === 'family'
							? m.admin_doctypes_role_family()
							: m.admin_doctypes_role_provider()}
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
						{item.isOptional ? m.common_optional() : m.common_required()}
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
					<span class="text-xs text-base-content-muted">{m.admin_doctypes_expiry_short()}</span>
				</label>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<span class="sr-only">{m.admin_doctypes_check_for({ name: item.name })}</span>
					<select
						class="select select-sm w-full max-w-full text-xs
							{item.credibledCheckTypeValue
							? 'border-credibled-border bg-credibled-tint text-credibled-text'
							: ''}"
						value={item.credibledCheckTypeValue ?? ''}
						disabled={busy}
						onchange={(event) => setCheckType(item, event.currentTarget)}
					>
						<option value="">{m.admin_doctypes_upload_only()}</option>
						{#each credibledCheckTypes as checkType (checkType.value)}
							<option value={checkType.value}>{checkType.label}</option>
						{/each}
					</select>
					{#if item.credibledCheckTypeValue}
						<span class="text-xs whitespace-nowrap text-base-content-muted">
							{item.credibledCostCents === null
								? m.admin_doctypes_no_price()
								: formatMoney(item.credibledCostCents)}
						</span>
					{/if}
				</label>
				<div class="mt-2 flex justify-end gap-1.5 lg:mt-0">
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label={m.admin_doctypes_edit_aria({ name: item.name })}
						onclick={() => openEdit(item)}
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label={m.admin_doctypes_delete_aria({ name: item.name })}
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
		{m.admin_doctypes_footnote()}
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
	title={m.admin_doctypes_delete_title({ name: deleting?.name ?? '' })}
	body={m.admin_doctypes_delete_body()}
	busy={deleteBusy}
	onconfirm={confirmDelete}
	oncancel={() => (deleting = null)}
/>
