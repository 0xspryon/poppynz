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
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';
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
	const limitMessage = $derived(
		`You can list up to ${maxServices} services — remove one to add another.`
	);

	async function addCatalogueService(item: CatalogueItem) {
		if (linkedCatalogueIds.has(item.id) || busyIds.has(item.id) || limitReached) return;
		busyIds.add(item.id);
		const result = await createServiceNeeded({
			name: item.name,
			catalogueServiceId: item.id
		});
		if (result.ok) {
			toast.success(`${item.name} added to your needs.`);
			await load();
		} else if (result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED') {
			toast.error(result.error.message, { title: `Could not add ${item.name}` });
		} else {
			toast.error(RETRY_MESSAGE, { title: `Could not add ${item.name}` });
		}
		busyIds.delete(item.id);
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		const result = await removeServiceNeeded(deleting.id);
		deleteBusy = false;
		if (result.ok) {
			toast.success(`${deleting.name} removed from your needs.`);
			deleting = null;
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: `Could not remove ${deleting.name}` });
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
					result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED'
						? result.error.message
						: RETRY_MESSAGE;
				toast.error(
					added > 0 ? `Only ${added} of ${ids.length} services were added. ${reason}` : reason,
					{ title: 'Could not add services' }
				);
				browseBusy = false;
				await load();
				return;
			}
			added += 1;
		}
		browseOpen = false;
		browseBusy = false;
		toast.success(added === 1 ? '1 service added.' : `${added} services added.`);
		await load();
	}
</script>

<svelte:head>
	<title>Services I need · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Services I need</h1>
		{#if limitReached && !loading}
			<span
				class="btn btn-outline btn-secondary btn-disabled"
				title={limitMessage}
				aria-disabled="true"
			>
				<i class="las la-plus" aria-hidden="true"></i>
				Add something else
			</span>
		{:else}
			<a href={resolve('/family/needs/custom')} class="btn btn-outline btn-secondary">
				<i class="las la-plus" aria-hidden="true"></i>
				Add something else
			</a>
		{/if}
	</div>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Tell helpers what you're looking for — vetted helpers near you can find your family by these
		needs.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage && services.length === 0 && catalogue.length === 0}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Common services
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
						<div class="mt-1 text-[10.5px] text-success">✓ In your list</div>
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
					Browse all {catalogue.length} services
				</span>
				<span class="text-[11px] text-base-content-muted">See the full list of services</span>
			</button>
		</div>

		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				Your needs · {services.length} / {maxServices}
			</span>
			<span class="text-xs text-outline">Helpers set their own rates for these services</span>
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
			<p class="rounded-lg border border-card-border bg-base-100 p-6 text-sm text-base-content-muted">
				Nothing listed yet — pick a common service above or add your own. Listing at least one need
				(plus a saved home location) lets vetted helpers find your family.
			</p>
		{:else}
			<div class="flex flex-col gap-2.5">
				{#each services as service (service.id)}
					<div class="rounded-[10px] border border-card-border bg-base-100 p-4">
						<div class="flex flex-wrap items-center gap-3.5">
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-400"
							>
								<i class="las la-heart text-lg text-secondary" aria-hidden="true"></i>
							</span>
							<div class="min-w-0 flex-1">
								<div class="text-sm font-semibold text-base-content">{service.name}</div>
								<div class="text-xs text-base-content-muted">
									{#if service.catalogueServiceId !== null}
										From the common list
									{:else}
										Your own request
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
								aria-label="Remove {service.name}"
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
	subtitle="Select the services your family is looking for."
	onadd={(ids) => void addSelected(ids)}
	oncancel={() => (browseOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title="Remove service"
	body="Remove “{deleting?.name}” from your needs? Helpers will no longer find you by it."
	confirmLabel="Remove"
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>
