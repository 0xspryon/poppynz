<script lang="ts">
	/** Provider-side family search: keyword + radius search over families who
	 * registered the services they need, with service / city filters. Search
	 * state lives in the URL so returning from a family profile restores it.
	 * Radius searches are centered server-side on the provider's saved
	 * location. Only approved providers may search — the API answers
	 * PROVIDER_NOT_APPROVED (403) until then, rendered as a dedicated state. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { searchFamilies, type FamilySearchData, type FamilySearchSort } from '$lib/api/families';
	import { getProfile } from '$lib/api/provider-profile';
	import { listLiveCatalogue } from '$lib/api/service-catalogue';
	import Pagination from '$lib/components/Pagination.svelte';
	import FamilyCard from '$lib/components/FamilyCard.svelte';
	import { withQuery } from '$lib/nav';
	import { m } from '$lib/paraglide/messages';
	import { startTourOnce } from '$lib/tour';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	const RADIUS_PRESETS = [10, 25, 50];
	const PER_PAGE = 18;

	const TOUR_KEY = 'poppynz-tour-sp-find-v1';
	const TOUR_STEPS = [
		{
			selector: '[data-tour="search"]',
			title: m.provider_find_tour_search_title(),
			description: m.provider_find_tour_search_desc()
		},
		{
			selector: '[data-tour="radius"]',
			title: m.provider_find_tour_radius_title(),
			description: m.provider_find_tour_radius_desc()
		},
		{
			selector: '[data-tour="filters"]',
			title: m.provider_find_tour_filters_title(),
			description: m.provider_find_tour_filters_desc()
		},
		{
			selector: '[data-tour="filters-mobile"]',
			title: m.provider_find_tour_filters_title(),
			description: m.provider_find_tour_filters_desc()
		},
		{
			selector: '[data-tour="sort"]',
			title: m.provider_find_tour_sort_title(),
			description: m.provider_find_tour_sort_desc()
		},
		{
			selector: '[data-tour="results"]',
			title: m.provider_find_tour_results_title(),
			description: m.provider_find_tour_results_desc()
		}
	];

	// --- applied search state (initialized from the URL, mirrored back to it) ---
	const initial = page.url.searchParams;
	const initialQ = initial.get('q') ?? '';
	const initialService = initial.get('service') ?? '';
	const initialCity = initial.get('city') ?? '';
	const cameFromUrl = initial.size > 0;

	let q = $state(initialQ);
	let service = $state(initialService);
	let city = $state(initialCity);
	let radiusKm = $state<number | null>(
		initial.get('radiusKm') ? Number(initial.get('radiusKm')) || null : null
	);
	let sort = $state<FamilySearchSort>(
		(['relevance', 'distance', 'newest'] as const).find((value) => value === initial.get('sort')) ??
			'relevance'
	);
	let pageNumber = $state(Math.max(1, Number(initial.get('page')) || 1));

	// --- draft inputs (applied on submit/blur) ---
	let qInput = $state(initialQ);
	let serviceQuery = $state('');
	let sheetOpen = $state(false);

	// --- provider home location (search origin) ---
	let profileLoaded = $state(false);
	let hasLocation = $state(false);
	let originLabel = $state('');

	// --- service catalogue (filter options) ---
	let catalogueNames = $state<Array<string>>([]);

	// --- results ---
	let loading = $state(true);
	let searchError = $state(false);
	let notApproved = $state(false);
	let data = $state<FamilySearchData | null>(null);
	let retryTick = $state(0);
	let requestId = 0;
	let tourStarted = false;

	// One-time walkthrough, once the page has settled and the provider can
	// actually search (the not-approved state has nothing to tour).
	$effect(() => {
		if (tourStarted || loading || !profileLoaded || notApproved) return;
		tourStarted = true;
		startTourOnce(TOUR_KEY, TOUR_STEPS);
	});

	onMount(() => {
		void getProfile().then((result) => {
			if (result.ok) {
				// The profile never exposes lat/lng; `hasLocation` says whether the
				// API holds coordinates for radius search (B9: a place id is not
				// required — seeded locations have coordinates without one).
				const profile = result.data;
				hasLocation = profile.hasLocation;
				originLabel = [profile.city, profile.stateProvince].filter(Boolean).join(', ');
				// Nearby-first default: providers with a saved location start on a
				// 10 km distance search unless the URL already carries a search.
				if (hasLocation && !cameFromUrl) {
					radiusKm = RADIUS_PRESETS[0];
					sort = 'distance';
				}
				if (!hasLocation && radiusKm != null) {
					radiusKm = null;
					if (sort === 'distance') sort = 'relevance';
				}
			}
			profileLoaded = true;
		});
		void listLiveCatalogue().then((result) => {
			if (result.ok) catalogueNames = result.data.map((item: { name: string }) => item.name);
		});
	});

	const qs = $derived.by(() => {
		const params = new SvelteURLSearchParams();
		if (q) params.set('q', q);
		if (service) params.set('service', service);
		if (city) params.set('city', city);
		if (radiusKm != null) params.set('radiusKm', String(radiusKm));
		if (sort !== 'relevance') params.set('sort', sort);
		if (pageNumber > 1) params.set('page', String(pageNumber));
		return params.toString();
	});

	$effect(() => {
		if (!profileLoaded) return;
		void retryTick;
		const snapshot = qs;
		const id = ++requestId;
		loading = true;
		searchError = false;
		void goto(withQuery(resolve('/service-provider/find'), snapshot), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		void searchFamilies({
			q: q || undefined,
			service: service || undefined,
			city: city || undefined,
			radiusKm: radiusKm ?? undefined,
			sort,
			page: pageNumber,
			perPage: PER_PAGE
		}).then((result) => {
			if (id !== requestId) return;
			loading = false;
			if (result.ok) {
				notApproved = false;
				data = result.data;
			} else if (result.error.code === 'PROVIDER_NOT_APPROVED') {
				notApproved = true;
			} else {
				searchError = true;
			}
		});
	});

	const total = $derived(data?.pagination.total ?? 0);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)));
	const filtersActive = $derived(Boolean(q || service || city));
	const activeFilterCount = $derived([q, service, city].filter(Boolean).length);
	const filteredCatalogue = $derived(
		catalogueNames.filter((name) => name.toLowerCase().includes(serviceQuery.trim().toLowerCase()))
	);
	// Free-form escape hatch: typed text becomes an exact service filter —
	// families write their own need names, so the catalogue list can never be
	// complete. Hidden when the text already matches a catalogue entry.
	const exactServiceOption = $derived.by(() => {
		const query = serviceQuery.trim();
		if (!query) return null;
		const exists = catalogueNames.some((name) => name.toLowerCase() === query.toLowerCase());
		return exists ? null : query;
	});
	// City dropdown options come from the search response facet (cities matching
	// the other active filters). Keep the currently selected city present even if
	// the latest facet set doesn't include it, so the select never loses its value.
	const cityOptions = $derived.by(() => {
		const facets = data?.facets.city ?? [];
		if (city && !facets.some((facet) => facet.value === city)) {
			return [{ value: city, count: 0 }, ...facets];
		}
		return facets;
	});

	function resetToFirstPage() {
		pageNumber = 1;
	}

	function submitKeyword(event: SubmitEvent) {
		event.preventDefault();
		q = qInput.trim();
		resetToFirstPage();
	}

	// Location has two mutually exclusive modes: "near me" (radius around home)
	// and "in a city". Picking a distance preset switches to near-me mode and
	// drops any selected city; picking a city (see selectCity) does the reverse.
	function pickRadius(value: number | null) {
		radiusKm = value;
		if (value != null) city = '';
		if (value == null && sort === 'distance') sort = 'relevance';
		if (value != null && !q) sort = 'distance';
		resetToFirstPage();
	}

	function toggleService(name: string) {
		service = service === name ? '' : name;
		resetToFirstPage();
	}

	function selectCity(value: string) {
		city = value;
		if (value) {
			// City mode: browse a place directly, so drop the radius-around-home
			// constraint (and distance sort, which has no meaning without a center).
			radiusKm = null;
			if (sort === 'distance') sort = 'relevance';
		} else if (hasLocation) {
			// Cleared back to near-me mode.
			radiusKm = RADIUS_PRESETS[0];
			if (!q) sort = 'distance';
		}
		resetToFirstPage();
	}

	function clearFilters() {
		q = '';
		qInput = '';
		service = '';
		city = '';
		resetToFirstPage();
	}

	function expandRadius() {
		const next = RADIUS_PRESETS.find((preset) => preset > (radiusKm ?? 0));
		if (next) pickRadius(next);
	}

	function detailQs(distanceKm: number | undefined): string {
		const params = new SvelteURLSearchParams();
		if (qs) params.set('from', qs);
		if (distanceKm !== undefined) params.set('d', String(distanceKm));
		return params.toString();
	}
</script>

<svelte:head>
	<title>{m.provider_find_page_title()}</title>
</svelte:head>

{#snippet filterControls()}
	<!-- Service facet: single-select — the search API filters one service at a time. -->
	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">{m.provider_find_service_legend()}</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.provider_find_service_needed()}
		</div>
		<label class="input input-sm mb-2 flex w-full items-center gap-2">
			<i class="las la-search text-outline" aria-hidden="true"></i>
			<input
				type="search"
				class="grow"
				placeholder={m.provider_find_filter_services_placeholder()}
				bind:value={serviceQuery}
			/>
		</label>
		{#if exactServiceOption}
			<label
				class="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-dashed
					border-primary bg-base-300 px-2.5 py-2"
			>
				<input
					type="checkbox"
					class="checkbox checkbox-primary checkbox-xs mt-0.5"
					checked={service === exactServiceOption}
					onchange={() => toggleService(exactServiceOption ?? '')}
				/>
				<span class="min-w-0">
					<span class="block truncate text-[13px] font-semibold text-base-content">
						“{exactServiceOption}”
					</span>
					<span class="mt-0.5 block text-[11px] leading-snug text-neutral">
						{m.provider_find_exact_service_hint()}
					</span>
				</span>
			</label>
		{/if}
		<div
			class="flex max-h-[78px] flex-col gap-1 overflow-y-auto overscroll-contain lg:max-h-[136px]"
		>
			{#each filteredCatalogue as name (name)}
				<label
					class="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-base-300"
				>
					<input
						type="checkbox"
						class="checkbox checkbox-primary checkbox-xs"
						checked={service === name}
						onchange={() => toggleService(name)}
					/>
					<span class="min-w-0 flex-1 truncate">{name}</span>
				</label>
			{:else}
				{#if !exactServiceOption}
					<p class="px-1 py-1 text-xs text-base-content-muted">
						{m.provider_find_no_services_match()}
					</p>
				{/if}
			{/each}
		</div>
	</fieldset>

	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">{m.provider_find_city()}</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.provider_find_city()}
		</div>
		<select
			class="select select-sm w-full"
			aria-label={m.provider_find_city()}
			value={city}
			onchange={(event) => selectCity(event.currentTarget.value)}
		>
			<option value="">{m.provider_find_all_cities()}</option>
			{#each cityOptions as option (option.value)}
				<option value={option.value}>
					{option.count
						? m.provider_find_city_option({ city: option.value, count: option.count })
						: option.value}
				</option>
			{/each}
		</select>
	</fieldset>

	<div class="rounded-xl bg-success-content p-4 text-[13px] leading-relaxed text-success">
		<i class="las la-home mr-1" aria-hidden="true"></i>
		{m.provider_find_every_family_note()}
	</div>
{/snippet}

<div class="mx-auto flex max-w-6xl flex-col gap-5">
	{#if notApproved}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<span class="flex size-14 items-center justify-center rounded-full bg-warning-content">
				<i class="las la-user-shield text-2xl text-warning" aria-hidden="true"></i>
			</span>
			<h1 class="font-display text-lg font-bold text-base-content">
				{m.provider_find_not_approved_title()}
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				{m.provider_find_not_approved_body()}
			</p>
			<a href={resolve('/service-provider/verification')} class="btn btn-primary btn-sm">
				{m.provider_find_check_approval()}
			</a>
		</div>
	{:else}
		<!-- Search header -->
		<form
			class="flex flex-col gap-3 rounded-xl border border-card-border bg-base-100 p-4"
			onsubmit={submitKeyword}
		>
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center">
				<label class="input flex min-w-0 flex-1 items-center gap-2" data-tour="search">
					<i class="las la-search text-outline" aria-hidden="true"></i>
					<input
						type="search"
						class="grow"
						placeholder={m.provider_find_search_placeholder()}
						aria-label={m.provider_find_search_aria()}
						bind:value={qInput}
					/>
				</label>
				<button type="submit" class="btn btn-primary lg:w-auto">{m.common_search()}</button>
			</div>

			<div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
				<div class="flex min-w-0 items-center gap-1.5 text-sm text-base-content-muted">
					<i class="las la-map-marker text-neutral" aria-hidden="true"></i>
					{#if !profileLoaded}
						<span class="skeleton h-4 w-40"></span>
					{:else if city}
						<span class="truncate"
							>{m.provider_find_location_in_before()}
							<strong class="text-base-content">{city}</strong></span
						>
						{#if hasLocation}
							<button
								type="button"
								class="shrink-0 text-xs font-semibold text-primary"
								onclick={() => selectCity('')}
							>
								{m.provider_find_search_near_me()}
							</button>
						{/if}
					{:else if hasLocation}
						<span class="truncate"
							>{m.provider_find_location_near_before()}
							<strong class="text-base-content">{originLabel}</strong></span
						>
						<a
							href={resolve('/service-provider/profile')}
							class="shrink-0 text-xs font-semibold text-primary"
						>
							{m.provider_find_change_location()}
						</a>
					{:else}
						<span>{m.provider_find_no_location()}</span>
						<a
							href={resolve('/service-provider/profile')}
							class="shrink-0 text-xs font-semibold text-primary"
						>
							{m.provider_find_set_location()}
						</a>
					{/if}
				</div>

				<div
					class="join"
					role="group"
					aria-label={m.provider_find_radius_aria()}
					data-tour="radius"
				>
					<button
						type="button"
						class="btn join-item btn-sm {radiusKm == null
							? 'btn-secondary'
							: 'btn-ghost border border-outline-variant'}"
						onclick={() => pickRadius(null)}
					>
						{m.provider_find_anywhere()}
					</button>
					{#each RADIUS_PRESETS as preset (preset)}
						<button
							type="button"
							class="btn join-item btn-sm {radiusKm === preset
								? 'btn-secondary'
								: 'btn-ghost border border-outline-variant'}"
							disabled={!hasLocation}
							onclick={() => pickRadius(preset)}
						>
							{m.provider_family_distance_short({ distance: preset })}
						</button>
					{/each}
				</div>
			</div>
		</form>

		<div class="flex items-start gap-6">
			<!-- Desktop filter rail -->
			<aside class="hidden w-64 shrink-0 flex-col gap-4 lg:flex" data-tour="filters">
				{@render filterControls()}
			</aside>

			<section class="min-w-0 flex-1" aria-live="polite" data-tour="results">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
					<h1 class="font-display text-xl font-bold text-base-content">
						{#if loading && !data}
							{m.provider_find_searching()}
						{:else}
							{radiusKm != null
								? m.provider_find_results_heading_near({ count: total })
								: city
									? m.provider_find_results_heading_city({ count: total, city })
									: m.provider_find_results_heading({ count: total })}
						{/if}
					</h1>
					<div class="flex items-center gap-2">
						<button
							type="button"
							class="btn relative btn-sm lg:hidden"
							data-tour="filters-mobile"
							onclick={() => (sheetOpen = true)}
						>
							<i class="las la-sliders-h" aria-hidden="true"></i>
							{m.provider_find_filters()}
							{#if activeFilterCount > 0}
								<span
									class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center
										rounded-full bg-accent text-[10px] font-bold text-accent-content"
								>
									{activeFilterCount}
								</span>
							{/if}
						</button>
						<label
							class="flex items-center gap-1.5 text-xs text-base-content-muted"
							data-tour="sort"
						>
							{m.provider_find_sort_by()}
							<select class="select select-sm w-auto" bind:value={sort} onchange={resetToFirstPage}>
								<option value="relevance">{m.provider_find_sort_relevance()}</option>
								{#if radiusKm != null}
									<option value="distance">{m.provider_find_sort_distance()}</option>
								{/if}
								<option value="newest">{m.provider_find_sort_newest()}</option>
							</select>
						</label>
					</div>
				</div>

				{#if filtersActive}
					<div class="mb-4 flex flex-wrap items-center gap-1.5">
						{#if q}
							<button
								type="button"
								class="badge gap-1 border-none bg-base-400 text-secondary"
								onclick={() => {
									q = '';
									qInput = '';
									resetToFirstPage();
								}}
							>
								“{q}” <i class="las la-times" aria-hidden="true"></i>
							</button>
						{/if}
						{#if service}
							<button
								type="button"
								class="badge gap-1 border-none bg-base-400 text-secondary"
								onclick={() => toggleService(service)}
							>
								{service} <i class="las la-times" aria-hidden="true"></i>
							</button>
						{/if}
						{#if city}
							<button
								type="button"
								class="badge gap-1 border-none bg-base-400 text-secondary"
								onclick={() => {
									city = '';
									resetToFirstPage();
								}}
							>
								{city} <i class="las la-times" aria-hidden="true"></i>
							</button>
						{/if}
						<button type="button" class="text-xs font-semibold text-primary" onclick={clearFilters}>
							{m.provider_find_clear_all()}
						</button>
					</div>
				{/if}

				{#if loading}
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{#each Array.from({ length: 6 }, (_, index) => index) as index (index)}
							<div class="flex flex-col gap-3 rounded-xl border border-card-border bg-base-100 p-4">
								<div class="flex items-center gap-3">
									<div class="skeleton size-[52px] shrink-0 rounded-full"></div>
									<div class="flex-1 space-y-2">
										<div class="skeleton h-3.5 w-2/3"></div>
										<div class="skeleton h-3 w-1/2"></div>
									</div>
								</div>
								<div class="skeleton h-3 w-full"></div>
								<div class="skeleton h-3 w-4/5"></div>
								<div class="flex gap-1.5">
									<div class="skeleton h-6 w-20 rounded-pill"></div>
									<div class="skeleton h-6 w-24 rounded-pill"></div>
								</div>
							</div>
						{/each}
					</div>
				{:else if searchError}
					<div
						class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
					>
						<span class="flex size-14 items-center justify-center rounded-full bg-error-content">
							<i class="las la-exclamation-triangle text-2xl text-error" aria-hidden="true"></i>
						</span>
						<h2 class="font-display text-lg font-bold text-base-content">
							{m.provider_family_error_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{m.provider_find_error_body()}
						</p>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={() => (retryTick = retryTick + 1)}
						>
							<i class="las la-redo-alt" aria-hidden="true"></i>
							{m.provider_find_retry_search()}
						</button>
					</div>
				{:else if total === 0 && filtersActive}
					<div
						class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
					>
						<span class="flex size-14 items-center justify-center rounded-full bg-base-400">
							<i class="las la-search text-2xl text-neutral" aria-hidden="true"></i>
						</span>
						<h2 class="font-display text-lg font-bold text-base-content">
							{m.provider_find_no_match_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{#if city}
								{m.provider_find_no_match_city()}
							{:else}
								{m.provider_find_no_match_radius()}
							{/if}
						</p>
						<div class="flex flex-wrap justify-center gap-2">
							{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
								<button type="button" class="btn btn-primary btn-sm" onclick={expandRadius}>
									{m.provider_find_expand_radius({
										distance: RADIUS_PRESETS.find((preset) => preset > (radiusKm ?? 0)) ?? ''
									})}
								</button>
							{:else if city && hasLocation}
								<button type="button" class="btn btn-primary btn-sm" onclick={() => selectCity('')}>
									{m.provider_find_search_near_me_instead()}
								</button>
							{/if}
							<button type="button" class="btn btn-sm" onclick={clearFilters}
								>{m.provider_find_clear_filters()}</button
							>
						</div>
					</div>
				{:else if total === 0}
					<div
						class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
					>
						<span class="flex size-14 items-center justify-center rounded-full bg-warning-content">
							<i class="las la-seedling text-2xl text-warning" aria-hidden="true"></i>
						</span>
						<h2 class="font-display text-lg font-bold text-base-content">
							{m.provider_find_empty_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{m.provider_find_empty_body()}
						</p>
						{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
							<button
								type="button"
								class="btn btn-primary btn-sm"
								onclick={() => pickRadius(RADIUS_PRESETS[RADIUS_PRESETS.length - 1])}
							>
								{m.provider_find_search_within({
									distance: RADIUS_PRESETS[RADIUS_PRESETS.length - 1]
								})}
							</button>
						{/if}
					</div>
				{:else if data}
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{#each data.families as family (family.userId)}
							<FamilyCard
								{family}
								href={withQuery(
									resolve('/service-provider/families/[userId]', { userId: family.userId }),
									detailQs(family.distanceKm)
								)}
							/>
						{/each}
					</div>

					<div class="mt-6">
						<Pagination
							page={pageNumber}
							{totalPages}
							label={m.provider_find_pagination_label()}
							onselect={(next) => (pageNumber = next)}
						/>
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>

<!-- Mobile filter bottom sheet -->
{#if sheetOpen && !notApproved}
	<div
		class="modal modal-bottom modal-open lg:hidden"
		role="dialog"
		aria-modal="true"
		aria-label={m.provider_find_filters()}
	>
		<div class="modal-box rounded-t-2xl">
			<div class="mx-auto mb-3 h-1 w-10 rounded-pill bg-outline-variant"></div>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="font-display text-lg font-bold text-base-content">
					{m.provider_find_filters()}
				</h2>
				<button type="button" class="text-xs font-semibold text-primary" onclick={clearFilters}>
					{m.provider_find_clear_all()}
				</button>
			</div>
			<div class="flex flex-col gap-3">
				{#if hasLocation}
					<div class="join" role="group" aria-label={m.provider_find_radius_aria()}>
						<button
							type="button"
							class="btn join-item btn-sm {radiusKm == null
								? 'btn-secondary'
								: 'btn-ghost border border-outline-variant'}"
							onclick={() => pickRadius(null)}
						>
							{m.provider_find_anywhere()}
						</button>
						{#each RADIUS_PRESETS as preset (preset)}
							<button
								type="button"
								class="btn join-item btn-sm {radiusKm === preset
									? 'btn-secondary'
									: 'btn-ghost border border-outline-variant'}"
								onclick={() => pickRadius(preset)}
							>
								{m.provider_family_distance_short({ distance: preset })}
							</button>
						{/each}
					</div>
				{/if}
				{@render filterControls()}
			</div>
			<div class="modal-action">
				<button type="button" class="btn w-full btn-primary" onclick={() => (sheetOpen = false)}>
					{#if loading}
						<span class="loading loading-sm loading-spinner"></span>
					{:else}
						{m.provider_find_show_count({ count: total })}
					{/if}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (sheetOpen = false)}
			aria-label={m.provider_find_close_filters()}
		></button>
	</div>
{/if}
