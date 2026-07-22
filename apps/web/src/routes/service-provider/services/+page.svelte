<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { listLiveCatalogue, type CatalogueItem } from '$lib/api/service-catalogue';
	import {
		createServiceOffered,
		listServicesOffered,
		removeServiceOffered,
		updateServiceOffered,
		type ServiceOffered
	} from '$lib/api/services-offered';
	import { centsToDollars, dollarsToCents } from '$lib/money';
	import BrowseServicesDialog from '$lib/components/BrowseServicesDialog.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';
	const COMMON_COUNT = 6;

	let catalogue = $state<Array<CatalogueItem>>([]);
	let services = $state<Array<ServiceOffered>>([]);
	let loading = $state(true);
	let errorMessage = $state('');

	// Per-row rate editing: draft dollar values + per-row error text.
	const rateDrafts = new SvelteMap<string, string>();
	const rowErrors = new SvelteMap<string, string>();
	const busyIds = new SvelteSet<string>();

	// Browse-all modal
	let browseOpen = $state(false);
	let browseBusy = $state(false);
	let browseError = $state('');

	let deleting = $state<ServiceOffered | null>(null);
	let deleteBusy = $state(false);

	async function load() {
		errorMessage = '';
		const [catalogueResult, servicesResult] = await Promise.all([
			listLiveCatalogue(),
			listServicesOffered()
		]);
		if (catalogueResult.ok && servicesResult.ok) {
			catalogue = catalogueResult.data;
			services = servicesResult.data;
			rateDrafts.clear();
			for (const service of servicesResult.data) {
				rateDrafts.set(service.id, centsToDollars(service.hourlyRateCents));
			}
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
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

	function floorFor(service: ServiceOffered): number | null {
		if (!service.catalogueServiceId) return null;
		const item = catalogue.find((entry) => entry.id === service.catalogueServiceId);
		return item?.baseHourlyRateCents ?? null;
	}

	async function addCatalogueService(item: CatalogueItem) {
		if (linkedCatalogueIds.has(item.id) || busyIds.has(item.id)) return;
		busyIds.add(item.id);
		errorMessage = '';
		const result = await createServiceOffered({
			name: item.name,
			hourlyRateCents: item.baseHourlyRateCents,
			catalogueServiceId: item.id
		});
		if (result.ok) {
			await load();
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		busyIds.delete(item.id);
	}

	async function saveRate(service: ServiceOffered) {
		const draft = rateDrafts.get(service.id) ?? '';
		const cents = dollarsToCents(draft);
		if (cents === null) {
			rowErrors.set(service.id, 'Enter a valid hourly rate.');
			return;
		}
		if (cents === service.hourlyRateCents) {
			rowErrors.delete(service.id);
			return;
		}
		const floor = floorFor(service);
		if (floor !== null && cents < floor) {
			rowErrors.set(
				service.id,
				`Below the $${centsToDollars(floor)} base rate for this service — raise it to save.`
			);
			return;
		}
		busyIds.add(service.id);
		const result = await updateServiceOffered(service.id, { hourlyRateCents: cents });
		if (result.ok) {
			services = services.map((entry) => (entry.id === service.id ? result.data : entry));
			rateDrafts.set(service.id, centsToDollars(result.data.hourlyRateCents));
			rowErrors.delete(service.id);
		} else if (result.error.code === 'SERVICE_RATE_BELOW_FLOOR') {
			rowErrors.set(service.id, result.error.message);
		} else {
			rowErrors.set(service.id, RETRY_MESSAGE);
		}
		busyIds.delete(service.id);
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		const result = await removeServiceOffered(deleting.id);
		deleteBusy = false;
		if (result.ok) {
			deleting = null;
			await load();
		}
	}

	async function addSelected(ids: Array<string>) {
		if (ids.length === 0 || browseBusy) return;
		browseBusy = true;
		browseError = '';
		for (const id of ids) {
			const item = catalogue.find((entry) => entry.id === id);
			if (!item) continue;
			const result = await createServiceOffered({
				name: item.name,
				hourlyRateCents: item.baseHourlyRateCents,
				catalogueServiceId: item.id
			});
			if (!result.ok) {
				browseError = RETRY_MESSAGE;
				browseBusy = false;
				return;
			}
		}
		browseOpen = false;
		browseBusy = false;
		await load();
	}

	function rateChipFor(service: ServiceOffered): { label: string; classes: string } | null {
		const floor = floorFor(service);
		if (floor === null) return null;
		const diff = service.hourlyRateCents - floor;
		if (diff > 0) {
			return {
				label: `+$${centsToDollars(diff)} over base`,
				classes: 'bg-success-content text-success'
			};
		}
		return { label: 'At base', classes: 'bg-info-content text-info' };
	}
</script>

<svelte:head>
	<title>Services & rates · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Services & rates</h1>
		<a href={resolve('/service-provider/services/custom')} class="btn btn-outline btn-secondary">
			<i class="las la-plus" aria-hidden="true"></i>
			Add a custom service
		</a>
	</div>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Pick the services you offer — each comes with a base rate you can raise, but not go below.
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
					disabled={busyIds.has(item.id)}
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
					<div class="text-xs text-base-content-muted">
						Base rate <b class="text-secondary">${centsToDollars(item.baseHourlyRateCents)}/hr</b>
					</div>
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
			>
				<span class="flex size-8 items-center justify-center rounded-full bg-base-400">
					<i class="las la-search text-base text-secondary" aria-hidden="true"></i>
				</span>
				<span class="text-[13px] font-semibold text-secondary">
					Browse all {catalogue.length} services
				</span>
				<span class="text-[11px] text-base-content-muted">See the full list with base rates</span>
			</button>
		</div>

		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				Your services · {services.length}
			</span>
			<span class="text-xs text-outline">Rates can't go below the base rate for the service</span>
		</div>

		{#if services.length === 0}
			<p class="rounded-lg border border-card-border bg-base-100 p-6 text-sm text-base-content-muted">
				Nothing listed yet — pick a common service above or add a custom one.
			</p>
		{:else}
			<div class="flex flex-col gap-2.5">
				{#each services as service (service.id)}
					{@const chip = rateChipFor(service)}
					{@const rowError = rowErrors.get(service.id)}
					<div
						class="rounded-[10px] border bg-base-100 p-4
							{rowError ? 'border-[1.5px] border-error' : 'border-card-border'}"
					>
						<div class="flex flex-wrap items-center gap-3.5">
							<span
								class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-400"
							>
								<i class="las la-heart text-lg text-secondary" aria-hidden="true"></i>
							</span>
							<div class="min-w-0 flex-1">
								<div class="text-sm font-semibold text-base-content">{service.name}</div>
								<div class="text-xs text-base-content-muted">
									{#if floorFor(service) !== null}
										Base rate ${centsToDollars(floorFor(service) ?? 0)}/hr
									{:else}
										Custom service
										{#if service.description}
											· {service.description}
										{/if}
									{/if}
								</div>
							</div>
							<label class="flex items-center gap-2">
								<span class="text-xs text-outline">Your rate</span>
								<span
									class="flex items-center overflow-hidden rounded-md border-[1.5px]
										{rowError ? 'border-error' : 'border-outline-variant'}"
								>
									<span
										class="border-r px-2.5 py-2 text-[13px] font-semibold
											{rowError
											? 'border-error-content bg-error-content text-error'
											: 'border-base-300 bg-base-200 text-base-content-muted'}"
									>
										$
									</span>
									<input
										class="w-20 px-3 py-2 text-sm text-base-content outline-none"
										value={rateDrafts.get(service.id) ?? ''}
										oninput={(event) =>
											rateDrafts.set(service.id, (event.currentTarget as HTMLInputElement).value)}
										onblur={() => void saveRate(service)}
										onkeydown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												(event.currentTarget as HTMLInputElement).blur();
											}
										}}
										aria-label="Hourly rate for {service.name}"
									/>
								</span>
							</label>
							{#if busyIds.has(service.id)}
								<span class="loading loading-spinner loading-sm text-primary"></span>
							{:else if chip && !rowError}
								<span class="rounded-sm px-2 py-1 text-[11.5px] font-semibold {chip.classes}">
									{chip.label}
								</span>
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
						{#if rowError}
							<p class="mt-2 ml-12 flex items-center gap-2 text-xs font-medium text-error">
								<i class="las la-exclamation-circle text-sm" aria-hidden="true"></i>
								{rowError}
							</p>
						{/if}
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
	error={browseError}
	onadd={(ids) => void addSelected(ids)}
	oncancel={() => (browseOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title="Remove service"
	body="Remove “{deleting?.name}” from your list? Families will no longer see it."
	confirmLabel="Remove"
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>
