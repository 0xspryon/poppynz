<script lang="ts">
	/** Family "services I need" list. Mirrors the provider services page minus
	 * rates — needs are descriptive only. A family with a saved location and at
	 * least one need becomes discoverable to approved providers. */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { listLiveCatalogue, type CatalogueItem } from '$lib/api/service-catalogue';
	import {
		createServiceNeeded,
		listServicesNeeded,
		removeServiceNeeded,
		type ServiceNeeded
	} from '$lib/api/services-needed';
	import BrowseServicesDialog from '$lib/components/BrowseServicesDialog.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = m.family_needs_retry();
	const COMMON_COUNT = 6;

	let catalogue = $state<Array<CatalogueItem>>([]);
	let services = $state<Array<ServiceNeeded>>([]);
	let maxServices = $state(20);
	let loading = $state(true);
	let errorMessage = $state('');

	const busyIds = new SvelteSet<string>();

	// Browse-all modal
	let browseOpen = $state(false);
	let browseBusy = $state(false);

	let deleting = $state<ServiceNeeded | null>(null);
	let deleteBusy = $state(false);

	async function load() {
		errorMessage = '';
		const [catalogueResult, servicesResult] = await Promise.all([
			listLiveCatalogue(),
			listServicesNeeded()
		]);
		if (catalogueResult.ok && servicesResult.ok) {
			catalogue = catalogueResult.data;
			services = servicesResult.data.services;
			maxServices = servicesResult.data.maxServicesNeeded;
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	const linkedCatalogueIds = $derived(
		new Set(
			services
				.map((service) => service.catalogueServiceId)
				.filter((id): id is string => id !== null)
		)
	);
	const commonServices = $derived(catalogue.slice(0, COMMON_COUNT));
	const limitReached = $derived(services.length >= maxServices);
	const limitMessage = $derived(m.family_needs_limit({ max: maxServices }));

	async function addCatalogueService(item: CatalogueItem) {
		if (linkedCatalogueIds.has(item.id) || busyIds.has(item.id) || limitReached) return;
		busyIds.add(item.id);
		const result = await createServiceNeeded({
			name: item.name,
			catalogueServiceId: item.id
		});
		if (result.ok) {
			toast.success(m.family_needs_added({ name: item.name }));
			await load();
		} else if (result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED') {
			toast.error(limitMessage, { title: m.family_needs_could_not_add({ name: item.name }) });
		} else {
			toast.error(RETRY_MESSAGE, { title: m.family_needs_could_not_add({ name: item.name }) });
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		const result = await removeServiceNeeded(deleting.id);
		deleteBusy = false;
		if (result.ok) {
			toast.success(m.family_needs_removed({ name: deleting.name }));
			deleting = null;
			await load();
		} else {
			toast.error(RETRY_MESSAGE, {
				title: m.family_needs_could_not_remove({ name: deleting.name })
			});
			deleting = null;
		}
	}

	async function addSelected(ids: Array<string>) {
		if (ids.length === 0 || browseBusy) return;
		browseBusy = true;
		let added = 0;
		for (const id of ids) {
			const item = catalogue.find((entry) => entry.id === id);
			if (!item) continue;
			const result = await createServiceNeeded({
				name: item.name,
				catalogueServiceId: item.id
			});
			if (!result.ok) {
				const reason =
					result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED' ? limitMessage : RETRY_MESSAGE;
				toast.error(
					added > 0 ? m.family_needs_partial_added({ added, total: ids.length, reason }) : reason,
					{ title: m.family_needs_could_not_add_services() }
				);
				browseBusy = false;
				await load();
				return;
			}
			added += 1;
		}
		browseOpen = false;
		browseBusy = false;
		toast.success(m.family_needs_added_count({ count: added }));
		await load();
	}
</script>

<svelte:head>
	<title>{m.family_needs_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
			{m.family_needs_title()}
		</h1>
		{#if limitReached && !loading}
			<span
				class="btn btn-outline btn-secondary btn-disabled"
				title={limitMessage}
				aria-disabled="true"
			>
				<i class="las la-plus" aria-hidden="true"></i>
				{m.family_needs_add_something_else()}
			</span>
		{:else}
			<a href={resolve('/family/needs/custom')} class="btn btn-outline btn-secondary">
				<i class="las la-plus" aria-hidden="true"></i>
				{m.family_needs_add_something_else()}
			</a>
		{/if}
	</div>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{m.family_needs_subtitle()}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage && services.length === 0 && catalogue.length === 0}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.family_needs_common_services()}
		</div>
		<div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
			{#each commonServices as item (item.id)}
				{@const inList = linkedCatalogueIds.has(item.id)}
				<button
					type="button"
					class="relative rounded-lg border-[1.5px] p-4 text-left transition-colors
						{inList
						? 'border-primary bg-base-400 shadow-focus-ring'
						: 'border-card-border bg-base-100 hover:border-primary/50'}"
					onclick={() => void addCatalogueService(item)}
					disabled={busyIds.has(item.id) || (limitReached && !inList)}
				>
					<span
						class="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full
							{inList ? 'bg-primary' : 'border-[1.5px] border-outline-variant'}"
					>
						{#if inList}
							<i class="las la-check text-xs text-primary-content" aria-hidden="true"></i>
						{/if}
					</span>
					<span
						class="mb-2.5 flex size-9 items-center justify-center rounded-lg
							{inList ? 'bg-base-100' : 'bg-base-400'}"
					>
						<i class="las la-heart text-lg text-secondary" aria-hidden="true"></i>
					</span>
					<div class="text-[13px] font-semibold text-base-content">{item.name}</div>
					<div class="text-xs text-base-content-muted">{item.category}</div>
					{#if inList}
						<div class="mt-1 text-[10.5px] text-success">
							{m.family_needs_in_your_list()}
						</div>
					{/if}
				</button>
			{/each}
			<button
				type="button"
				class="flex flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px]
					border-dashed border-primary bg-base-200 p-4 transition-colors hover:bg-base-300"
				onclick={() => (browseOpen = true)}
				disabled={limitReached}
				title={limitReached ? limitMessage : undefined}
			>
				<span class="flex size-8 items-center justify-center rounded-full bg-base-400">
					<i class="las la-search text-base text-secondary" aria-hidden="true"></i>
				</span>
				<span class="text-[13px] font-semibold text-secondary">
					{m.family_needs_browse_all({ count: catalogue.length })}
				</span>
				<span class="text-[11px] text-base-content-muted">
					{m.family_needs_browse_all_hint()}
				</span>
			</button>
		</div>

		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				{m.family_needs_your_needs({ count: services.length, max: maxServices })}
			</span>
			<span class="text-xs text-outline">
				{m.family_needs_rates_hint()}
			</span>
		</div>

		{#if limitReached}
			<p
				class="mb-2.5 flex items-center gap-2 rounded-lg bg-warning-content px-3 py-2 text-xs
					font-medium text-warning"
			>
				<i class="las la-info-circle text-sm" aria-hidden="true"></i>
				{limitMessage}
			</p>
		{/if}

		{#if services.length === 0}
			<p
				class="rounded-lg border border-card-border bg-base-100 p-6 text-sm text-base-content-muted"
			>
				{m.family_needs_empty()}
			</p>
		{:else}
			<div class="flex flex-col gap-2.5">
				{#each services as service (service.id)}
					<div class="rounded-[10px] border border-card-border bg-base-100 p-4">
						<div class="flex flex-wrap items-center gap-3.5">
							<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-400">
								<i class="las la-heart text-lg text-secondary" aria-hidden="true"></i>
							</span>
							<div class="min-w-0 flex-1">
								<div class="text-sm font-semibold text-base-content">{service.name}</div>
								<div class="text-xs text-base-content-muted">
									{#if service.catalogueServiceId !== null}
										{m.family_needs_from_common_list()}
									{:else}
										{m.family_needs_own_request()}
									{/if}
									{#if service.description}
										· {service.description}
									{/if}
								</div>
							</div>
							{#if busyIds.has(service.id)}
								<span class="loading loading-spinner loading-sm text-primary"></span>
							{/if}
							<button
								type="button"
								class="flex size-8 items-center justify-center rounded-[7px] border
									border-card-border text-outline transition-colors hover:border-error
									hover:text-error"
								aria-label={m.family_needs_remove_aria({ name: service.name })}
								onclick={() => (deleting = service)}
							>
								<i class="las la-trash-alt text-base" aria-hidden="true"></i>
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<BrowseServicesDialog
	open={browseOpen}
	{catalogue}
	linkedIds={linkedCatalogueIds}
	busy={browseBusy}
	subtitle={m.family_needs_browse_subtitle()}
	ratesAreStartingPrices
	onadd={(ids) => void addSelected(ids)}
	oncancel={() => (browseOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title={m.family_needs_remove_title()}
	body={m.family_needs_remove_body({ name: deleting?.name ?? '' })}
	confirmLabel={m.family_needs_remove_confirm()}
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>
