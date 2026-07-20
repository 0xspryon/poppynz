<script lang="ts">
	import {
		createCatalogueItem,
		listCatalogue,
		removeCatalogueItem,
		updateCatalogueItem,
		type CatalogueItem
	} from '$lib/api/service-catalogue';
	import { centsToDollars, dollarsToCents } from '$lib/money';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let items: Array<CatalogueItem> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	const busyIds = new SvelteSet<string>();

	// Create/edit modal
	let modalOpen = $state(false);
	let editing: CatalogueItem | null = $state(null);
	let draftName = $state('');
	let draftCategory = $state('');
	let draftRate = $state('');
	let draftIsLive = $state(true);
	let saving = $state(false);
	let modalError: string | null = $state(null);

	// Delete confirmation
	let deleting: CatalogueItem | null = $state(null);
	let deleteBusy = $state(false);

	const categories = $derived([...new Set(items.map((item) => item.category))].sort());
	const draftRateCents = $derived(dollarsToCents(draftRate));
	const canSave = $derived(draftName.trim() !== '' && draftCategory.trim() !== '' && draftRateCents !== null);

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? 'Your account is not authorized to manage the service catalogue.'
			: error.code === 'UNAUTHORIZED'
				? 'Your session has expired — sign in again.'
				: RETRY_MESSAGE;

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

	$effect(() => {
		void load();
	});

	function openCreate() {
		editing = null;
		draftName = '';
		draftCategory = '';
		draftRate = '';
		draftIsLive = true;
		modalError = null;
		modalOpen = true;
	}

	function openEdit(item: CatalogueItem) {
		editing = item;
		draftName = item.name;
		draftCategory = item.category;
		draftRate = centsToDollars(item.baseHourlyRateCents);
		draftIsLive = item.isLive;
		modalError = null;
		modalOpen = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving || !canSave || draftRateCents === null) return;
		saving = true;
		modalError = null;
		const draft = {
			name: draftName.trim(),
			category: draftCategory.trim(),
			baseHourlyRateCents: draftRateCents,
			isLive: draftIsLive
		};
		const result = editing
			? await updateCatalogueItem(editing.id, draft)
			: await createCatalogueItem(draft);
		if (result.ok) {
			modalOpen = false;
			await load();
		} else {
			modalError =
				result.error.code === 'INVALID_SERVICE_CATALOGUE_INPUT'
					? 'Check the fields — name and category are required, and the base rate must be a positive amount.'
					: errorText(result.error);
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
			errorMessage = null;
		} else {
			input.checked = !value;
			errorMessage = errorText(result.error);
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeCatalogueItem(deleting.id);
		if (result.ok) {
			deleting = null;
			await load();
		} else {
			errorMessage = errorText(result.error);
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>Service catalogue · Poppynz admin</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			Service catalogue
		</h1>
		<p class="text-sm text-base-content-muted">
			The base services providers pick from. Each base rate is a floor — providers can raise it,
			never go below.
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={openCreate}>
		<i class="las la-plus" aria-hidden="true"></i>
		New service
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
		<p class="mb-1 font-semibold text-base-content">The catalogue is empty</p>
		<p class="text-sm text-base-content-muted">
			Add the first base service so providers have something to pick from.
		</p>
	</div>
{:else}
	<!-- Desktop: header row + card rows (per design 8e) -->
	<div
		class="mb-2 hidden grid-cols-[1fr_170px_150px_130px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>Service</span><span>Category</span><span>Base rate</span><span>Status</span>
		<span class="text-right">Actions</span>
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
					<span class="text-sm font-semibold text-base-content lg:hidden">
						${centsToDollars(item.baseHourlyRateCents)}<span
							class="text-xs font-normal text-outline"
						>
							/hr</span
						>
					</span>
				</div>
				<div class="mb-2 lg:mb-0">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						{item.category}
					</span>
				</div>
				<div class="hidden text-sm font-semibold text-base-content lg:block">
					${centsToDollars(item.baseHourlyRateCents)}
					<span class="text-xs font-normal text-outline">/ hour</span>
				</div>
				<label class="flex items-center gap-2 py-1 lg:py-0">
					<input
						type="checkbox"
						class="toggle toggle-sm toggle-primary"
						checked={item.isLive}
						disabled={busy}
						onchange={(event) => toggleLive(item, event.currentTarget)}
					/>
					<span class="text-xs text-base-content-muted">{item.isLive ? 'Live' : 'Hidden'}</span>
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

	<p class="mt-4 max-w-2xl text-xs text-outline">
		Rate changes apply to new provider listings only — providers already offering a service keep
		their current rate until they edit it. Hidden services stay on existing provider profiles but
		can't be newly added.
	</p>
{/if}

{#if modalOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<form class="modal-box max-w-xl border border-card-border" onsubmit={save}>
			<h3 class="font-display text-xl font-bold text-base-content">
				{editing ? 'Edit service' : 'New service'}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				The base rate is the floor providers can raise but never undercut.
			</p>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Name · ≤120</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						required
						placeholder="Weekend babysitting"
						bind:value={draftName}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Category</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="80"
						required
						placeholder="Childcare"
						list="catalogue-categories"
						bind:value={draftCategory}
					/>
					<datalist id="catalogue-categories">
						{#each categories as category (category)}
							<option value={category}></option>
						{/each}
					</datalist>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Base rate / hour</legend>
					<label class="input w-full {draftRate !== '' && draftRateCents === null ? 'input-error' : ''}">
						<span class="text-outline">$</span>
						<input
							type="text"
							class="grow"
							inputmode="decimal"
							required
							placeholder="19.00"
							bind:value={draftRate}
						/>
					</label>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Unit</legend>
					<select class="select w-full" disabled>
						<option>Per hour</option>
					</select>
				</fieldset>
			</div>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" checked disabled />
					<span class="text-sm font-medium text-base-content">
						Rate is a floor — providers may raise it
					</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" bind:checked={draftIsLive} />
					<span class="text-sm font-medium text-base-content">Live in the provider catalogue</span>
				</label>
			</div>

			{#if modalError}
				<p class="mt-4 text-sm font-medium text-error" role="alert">{modalError}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (modalOpen = false)} disabled={saving}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={saving || !canSave}>
					{#if saving}<span class="loading loading-spinner loading-sm"></span>{/if}
					Save service
				</button>
			</div>
		</form>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (modalOpen = false)}
			aria-label="Close"
		></button>
	</div>
{/if}

<ConfirmDialog
	open={deleting !== null}
	title="Delete {deleting?.name}?"
	body="This is a soft delete — providers already offering this service keep it, but it disappears from the catalogue and can't be newly added."
	busy={deleteBusy}
	onconfirm={confirmDelete}
	oncancel={() => (deleting = null)}
/>
