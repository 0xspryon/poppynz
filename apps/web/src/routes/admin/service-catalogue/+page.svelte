<script lang="ts">
	import { onMount } from 'svelte';
	import {
		createCatalogueItem,
		listCatalogue,
		removeCatalogueItem,
		updateCatalogueItem,
		type CatalogueItem
	} from '$lib/api/service-catalogue';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { listDocumentTypes } from '$lib/api/document-types';
	import CatalogueItemDialog, {
		type CatalogueItemDraft
	} from '$lib/components/admin/CatalogueItemDialog.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let items: Array<CatalogueItem> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	const busyIds = new SvelteSet<string>();

	// Create/edit modal
	let modalOpen = $state(false);
	let editing: CatalogueItem | null = $state(null);
	let saving = $state(false);
	let modalError: string | null = $state(null);

	// Delete confirmation
	let deleting: CatalogueItem | null = $state(null);
	let deleteBusy = $state(false);

	let credentialTypes = $state<Array<{ id: string; name: string }>>([]);

	const credentialName = (id: string | null) =>
		credentialTypes.find((type) => type.id === id)?.name ?? null;

	const categories = $derived([...new Set(items.map((item) => item.category))].sort());

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? m.admin_catalogue_error_forbidden()
			: error.code === 'UNAUTHORIZED'
				? m.admin_catalogue_error_session()
				: m.admin_catalogue_error_retry();

	async function load() {
		loading = true;
		const result = await listCatalogue();
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
		void listDocumentTypes().then((result) => {
			if (result.ok) {
				credentialTypes = result.data
					.filter((type) => type.appliesToRole === 'service-provider' && !type.isSafetyGate)
					.map((type) => ({ id: type.id, name: type.name }));
			}
		});
	});

	function openCreate() {
		editing = null;
		modalError = null;
		modalOpen = true;
	}

	function openEdit(item: CatalogueItem) {
		editing = item;
		modalError = null;
		modalOpen = true;
	}

	async function save(draft: CatalogueItemDraft) {
		if (saving) return;
		saving = true;
		modalError = null;
		const result = editing
			? await updateCatalogueItem(editing.id, draft)
			: await createCatalogueItem(draft);
		if (result.ok) {
			modalOpen = false;
			toast.success(
				editing
					? m.admin_catalogue_updated_toast({ name: result.data.name })
					: m.admin_catalogue_created_toast({ name: result.data.name })
			);
			await load();
		} else if (result.error.code === 'INVALID_SERVICE_CATALOGUE_INPUT') {
			// Field validation stays next to the inputs inside the dialog.
			modalError = m.admin_catalogue_invalid_input();
		} else if (result.error.code === 'SERVICE_CATALOGUE_CREDENTIAL_INVALID') {
			modalError = m.admin_catalogue_credential_invalid();
		} else {
			toast.error(errorText(result.error), {
				title: editing ? m.admin_catalogue_not_updated_title() : m.admin_catalogue_not_created_title()
			});
		}
		saving = false;
	}

	/** Inline Live/Hidden toggle: pessimistic, reverted on failure. */
	async function toggleLive(item: CatalogueItem, input: HTMLInputElement) {
		const value = input.checked;
		busyIds.add(item.id);
		const result = await updateCatalogueItem(item.id, { isLive: value });
		if (result.ok) {
			items = items.map((candidate) => (candidate.id === item.id ? result.data : candidate));
			toast.success(
				result.data.isLive
					? m.admin_catalogue_live_toast({ name: result.data.name })
					: m.admin_catalogue_hidden_toast({ name: result.data.name })
			);
		} else {
			input.checked = !value;
			toast.error(errorText(result.error), { title: m.admin_catalogue_item_not_updated_title({ name: item.name }) });
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeCatalogueItem(deleting.id);
		if (result.ok) {
			toast.success(m.admin_catalogue_deleted_toast({ name: deleting.name }));
			deleting = null;
			await load();
		} else {
			toast.error(errorText(result.error), {
				title: m.admin_catalogue_item_not_deleted_title({ name: deleting.name })
			});
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>{m.admin_catalogue_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.admin_catalogue_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.admin_catalogue_intro()}
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={openCreate}>
		<i class="las la-plus" aria-hidden="true"></i>
		{m.admin_catalogue_new()}
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
		<p class="mb-1 font-semibold text-base-content">{m.admin_catalogue_empty_title()}</p>
		<p class="text-sm text-base-content-muted">
			{m.admin_catalogue_empty_body()}
		</p>
	</div>
{:else}
	<!-- Desktop: header row + card rows (per design 8e) -->
	<div
		class="mb-2 hidden grid-cols-[1fr_170px_150px_130px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>{m.admin_catalogue_col_service()}</span><span>{m.admin_catalogue_col_category()}</span>
		<span>{m.admin_catalogue_col_base_rate()}</span><span>{m.admin_catalogue_col_status()}</span>
		<span class="text-right">{m.admin_catalogue_col_actions()}</span>
	</div>
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const busy = busyIds.has(item.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[1fr_170px_150px_130px_90px] lg:items-center lg:gap-3.5
					{item.isLive ? '' : 'opacity-65'}"
			>
				<div class="mb-1 flex items-center justify-between lg:mb-0 lg:block">
					<span class="text-sm font-semibold text-base-content">{item.name}</span>
					{#if item.requiredDocumentTypeId}
						<span class="text-[11px] text-outline">
							<i class="las la-certificate" aria-hidden="true"></i>
							{credentialName(item.requiredDocumentTypeId)
								? m.admin_catalogue_needs_credential({
										credential: credentialName(item.requiredDocumentTypeId) ?? ''
									})
								: m.admin_catalogue_needs_any_credential()}
						</span>
					{/if}
					<span class="text-sm font-semibold text-base-content lg:hidden">
						{formatMoney(item.baseHourlyRateCents)}<span class="text-xs font-normal text-outline"
							>{m.admin_catalogue_per_hour_short()}</span
						>
					</span>
				</div>
				<div class="mb-2 lg:mb-0">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						{item.category}
					</span>
				</div>
				<div class="hidden text-sm font-semibold text-base-content lg:block">
					{formatMoney(item.baseHourlyRateCents)}
					<span class="text-xs font-normal text-outline">{m.admin_catalogue_per_hour_long()}</span>
				</div>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<input
						type="checkbox"
						class="toggle toggle-sm toggle-primary"
						checked={item.isLive}
						disabled={busy}
						onchange={(event) => toggleLive(item, event.currentTarget)}
					/>
					<span class="text-xs text-base-content-muted">{item.isLive
							? m.admin_catalogue_live()
							: m.admin_catalogue_hidden()}</span>
				</label>
				<div class="mt-2 flex justify-end gap-1.5 lg:mt-0">
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label={m.admin_catalogue_edit_aria({ name: item.name })}
						onclick={() => openEdit(item)}
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label={m.admin_catalogue_delete_aria({ name: item.name })}
						onclick={() => (deleting = item)}
					>
						<i class="las la-trash-alt text-base" aria-hidden="true"></i>
					</button>
				</div>
			</div>
		{/each}
	</div>

	<p class="mt-4 max-w-2xl text-xs text-outline">
		{m.admin_catalogue_footnote()}
	</p>
{/if}

<CatalogueItemDialog
	open={modalOpen}
	{editing}
	{categories}
	{credentialTypes}
	busy={saving}
	error={modalError}
	onsave={(draft) => void save(draft)}
	oncancel={() => (modalOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title={m.admin_catalogue_delete_title({ name: deleting?.name ?? '' })}
	body={m.admin_catalogue_delete_body()}
	busy={deleteBusy}
	onconfirm={confirmDelete}
	oncancel={() => (deleting = null)}
/>
