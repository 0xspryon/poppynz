<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { listLiveCatalogue, type CatalogueItem } from '$lib/api/service-catalogue';
	import {
		createServiceOffered,
		listServicesOffered,
		removeServiceOffered,
		updateServiceOffered,
		type ServiceMutationError,
		type ServiceOffered
	} from '$lib/api/services-offered';
	import { acceptTcs, listPendingTcs, tcCheckboxLabel, type PublishedTc } from '$lib/api/tcs';
	import { centsToDollars, dollarsToCents, formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import BrowseServicesDialog from '$lib/components/BrowseServicesDialog.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import TcModal from '$lib/components/TcModal.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = m.common_error_generic();
	const COMMON_COUNT = 6;

	let catalogue = $state<Array<CatalogueItem>>([]);
	let services = $state<Array<ServiceOffered>>([]);
	let maxServices = $state(20);
	let customBaseRateCents = $state(2000);
	let loading = $state(true);
	let errorMessage = $state('');

	// Per-row rate editing: draft dollar values + per-row error text.
	const rateDrafts = new SvelteMap<string, string>();
	const rowErrors = new SvelteMap<string, string>();
	const busyIds = new SvelteSet<string>();

	// Browse-all modal
	let browseOpen = $state(false);
	let browseBusy = $state(false);

	let deleting = $state<ServiceOffered | null>(null);
	let deleteBusy = $state(false);

	// The earning-fee terms gate this page: shown as soon as it opens, until
	// the provider accepts the latest published version.
	let feeTerms = $state<PublishedTc | null>(null);
	let feeTermsBusy = $state(false);
	let feeTermsError = $state<string | null>(null);

	async function loadFeeTerms() {
		const result = await listPendingTcs();
		if (result.ok) {
			feeTerms = result.data.find((tc) => tc.slug === 'service_provider_fee_acceptance') ?? null;
		}
	}

	onMount(() => {
		void loadFeeTerms();
	});

	async function acceptFeeTerms() {
		if (!feeTerms || feeTermsBusy) return;
		feeTermsBusy = true;
		feeTermsError = null;
		const result = await acceptTcs([{ slug: feeTerms.slug, versionId: feeTerms.versionId }]);
		if (result.ok) {
			feeTerms = null;
		} else if (result.error.code === 'TC_VERSION_STALE') {
			feeTermsError = m.provider_services_terms_stale();
			await loadFeeTerms();
		} else {
			feeTermsError = m.provider_services_terms_failed();
		}
		feeTermsBusy = false;
	}

	async function load() {
		errorMessage = '';
		const [catalogueResult, servicesResult] = await Promise.all([
			listLiveCatalogue(),
			listServicesOffered()
		]);
		if (catalogueResult.ok && servicesResult.ok) {
			catalogue = catalogueResult.data;
			services = servicesResult.data.services;
			maxServices = servicesResult.data.maxServicesOffered;
			customBaseRateCents = servicesResult.data.customServiceBaseRateCents;
			rateDrafts.clear();
			for (const service of servicesResult.data.services) {
				rateDrafts.set(service.id, centsToDollars(service.hourlyRateCents));
			}
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
	const limitMessage = $derived(m.provider_services_limit({ max: maxServices }));

	/** Localized text for a create/update failure (the API's messages are English). */
	function mutationErrorText(error: ServiceMutationError, serviceName: string): string {
		switch (error.code) {
			case 'SERVICES_OFFERED_LIMIT_REACHED':
				return m.provider_services_limit({ max: error.max });
			case 'SERVICE_CREDENTIAL_REQUIRED':
				return m.provider_services_credential_required({ service: serviceName });
			case 'SERVICE_RATE_BELOW_FLOOR':
				return m.provider_services_rate_below_floor({ amount: formatMoney(error.floorCents) });
			default:
				return RETRY_MESSAGE;
		}
	}

	function floorFor(service: ServiceOffered): number | null {
		// Custom services floor at the platform base rate (UAT #34).
		if (!service.catalogueServiceId) return customBaseRateCents;
		const item = catalogue.find((entry) => entry.id === service.catalogueServiceId);
		return item?.baseHourlyRateCents ?? null;
	}

	async function addCatalogueService(item: CatalogueItem) {
		if (linkedCatalogueIds.has(item.id) || busyIds.has(item.id) || limitReached) return;
		busyIds.add(item.id);
		const result = await createServiceOffered({
			name: item.name,
			hourlyRateCents: item.baseHourlyRateCents,
			catalogueServiceId: item.id
		});
		if (result.ok) {
			toast.success(m.provider_services_added({ name: item.name }));
			await load();
		} else if (
			result.error.code === 'SERVICES_OFFERED_LIMIT_REACHED' ||
			result.error.code === 'SERVICE_CREDENTIAL_REQUIRED'
		) {
			toast.error(mutationErrorText(result.error, item.name), {
				title: m.provider_services_add_failed_title({ name: item.name })
			});
		} else {
			toast.error(RETRY_MESSAGE, {
				title: m.provider_services_add_failed_title({ name: item.name })
			});
		}
		busyIds.delete(item.id);
	}

	async function saveRate(service: ServiceOffered) {
		const draft = rateDrafts.get(service.id) ?? '';
		const cents = dollarsToCents(draft);
		if (cents === null) {
			rowErrors.set(service.id, m.provider_services_rate_invalid());
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
				m.provider_services_rate_below_floor({ amount: formatMoney(floor) })
			);
			return;
		}
		busyIds.add(service.id);
		const result = await updateServiceOffered(service.id, { hourlyRateCents: cents });
		if (result.ok) {
			services = services.map((entry) => (entry.id === service.id ? result.data : entry));
			rateDrafts.set(service.id, centsToDollars(result.data.hourlyRateCents));
			rowErrors.delete(service.id);
			toast.success(
				m.provider_services_rate_updated({
					name: service.name,
					amount: formatMoney(result.data.hourlyRateCents)
				})
			);
		} else if (result.error.code === 'SERVICE_RATE_BELOW_FLOOR') {
			rowErrors.set(service.id, mutationErrorText(result.error, service.name));
		} else if (result.error.code === 'SERVICE_CREDENTIAL_REQUIRED') {
			toast.error(mutationErrorText(result.error, service.name), {
				title: m.provider_services_not_updated_title({ name: service.name })
			});
		} else {
			toast.error(RETRY_MESSAGE, {
				title: m.provider_services_rate_not_saved_title({ name: service.name })
			});
		}
		busyIds.delete(service.id);
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		const result = await removeServiceOffered(deleting.id);
		deleteBusy = false;
		if (result.ok) {
			toast.success(m.provider_services_removed({ name: deleting.name }));
			deleting = null;
			await load();
		} else {
			toast.error(RETRY_MESSAGE, {
				title: m.provider_services_remove_failed_title({ name: deleting.name })
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
			const result = await createServiceOffered({
				name: item.name,
				hourlyRateCents: item.baseHourlyRateCents,
				catalogueServiceId: item.id
			});
			if (!result.ok) {
				const reason = mutationErrorText(result.error, item.name);
				toast.error(
					added > 0
						? m.provider_services_partial_added({ added, total: ids.length, reason })
						: reason,
					{ title: m.provider_services_add_many_failed_title() }
				);
				browseBusy = false;
				await load();
				return;
			}
			added += 1;
		}
		browseOpen = false;
		browseBusy = false;
		toast.success(m.provider_services_added_count({ count: added }));
		await load();
	}

	function rateChipFor(service: ServiceOffered): { label: string; classes: string } | null {
		const floor = floorFor(service);
		if (floor === null) return null;
		const diff = service.hourlyRateCents - floor;
		if (diff > 0) {
			return {
				label: m.provider_services_over_base({ amount: formatMoney(diff) }),
				classes: 'bg-success-content text-success'
			};
		}
		return { label: m.provider_services_at_base(), classes: 'bg-info-content text-info' };
	}
</script>

<svelte:head>
	<title>{m.provider_services_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
			{m.provider_services_title()}
		</h1>
		{#if limitReached && !loading}
			<span
				class="btn btn-outline btn-secondary btn-disabled"
				title={limitMessage}
				aria-disabled="true"
			>
				<i class="las la-plus" aria-hidden="true"></i>
				{m.provider_services_add_custom()}
			</span>
		{:else}
			<a href={resolve('/service-provider/services/custom')} class="btn btn-outline btn-secondary">
				<i class="las la-plus" aria-hidden="true"></i>
				{m.provider_services_add_custom()}
			</a>
		{/if}
	</div>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{m.provider_services_intro()}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage && services.length === 0 && catalogue.length === 0}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.provider_services_common()}
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
					<div class="text-xs text-base-content-muted">
						{m.provider_services_base_rate_label()}
						<b class="text-secondary"
							>{m.money_per_hour({ amount: formatMoney(item.baseHourlyRateCents) })}</b
						>
					</div>
					{#if inList}
						<div class="mt-1 text-[10.5px] text-success">{m.provider_services_in_list()}</div>
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
					{m.provider_services_browse_all({ count: catalogue.length })}
				</span>
				<span class="text-[11px] text-base-content-muted">{m.provider_services_browse_hint()}</span>
			</button>
		</div>

		<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
			<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
				{m.provider_services_yours({ count: services.length, max: maxServices })}
			</span>
			<span class="text-xs text-outline">{m.provider_services_floor_note()}</span>
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
				{m.provider_services_empty()}
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
							<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-400">
								<i class="las la-heart text-lg text-secondary" aria-hidden="true"></i>
							</span>
							<div class="min-w-0 flex-1">
								<div
									class="flex flex-wrap items-center gap-2 text-sm font-semibold text-base-content"
								>
									{service.name}
									{#if service.reviewStatus === 'pending'}
										<span
											class="rounded-sm bg-info-content px-1.5 py-0.5 text-[10.5px] font-semibold text-info"
										>
											{m.provider_services_awaiting_review()}
										</span>
									{:else if service.reviewStatus === 'rejected'}
										<span
											class="rounded-sm bg-error-content px-1.5 py-0.5 text-[10.5px] font-semibold text-error"
										>
											{m.provider_services_not_approved()}
										</span>
									{/if}
								</div>
								<div class="text-xs text-base-content-muted">
									{#if service.catalogueServiceId}
										{m.provider_services_base_rate_line({
											amount: formatMoney(floorFor(service) ?? 0)
										})}
									{:else}
										{m.provider_services_custom_from({ amount: formatMoney(customBaseRateCents) })}
										{#if service.description}
											· {service.description}
										{/if}
									{/if}
								</div>
								{#if service.reviewStatus === 'pending'}
									<div class="mt-0.5 text-[11.5px] text-outline">
										{m.provider_services_pending_note()}
									</div>
								{:else if service.reviewStatus === 'rejected' && service.reviewReason}
									<div class="mt-0.5 text-[11.5px] text-error">{service.reviewReason}</div>
								{/if}
							</div>
							<label class="flex items-center gap-2">
								<span class="text-xs text-outline">{m.provider_services_your_rate()}</span>
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
										aria-label={m.provider_services_rate_aria({ name: service.name })}
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
								aria-label={m.provider_services_remove_aria({ name: service.name })}
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
	onadd={(ids) => void addSelected(ids)}
	oncancel={() => (browseOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title={m.provider_services_remove_title()}
	body={m.provider_services_remove_body({ name: deleting?.name ?? '' })}
	confirmLabel={m.common_remove()}
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>

{#if feeTerms}
	<TcModal
		open
		title={feeTerms.title}
		content={feeTerms.content}
		checkboxLabel={tcCheckboxLabel(feeTerms)}
		notice={feeTerms.fallback ? m.tc_english_governs_notice() : null}
		intro={m.provider_services_fee_intro()}
		busy={feeTermsBusy}
		error={feeTermsError}
		onaccept={acceptFeeTerms}
	/>
{/if}
