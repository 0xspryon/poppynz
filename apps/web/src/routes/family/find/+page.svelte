<script lang="ts">
	/** Family marketplace search (design 13b/13c/13d): keyword + radius search
	 * over the vetted-provider pool with service / rate / city filters. Search
	 * state lives in the URL so returning from a profile restores it. Radius
	 * searches are centered server-side on the family's saved home location —
	 * "Change" points at the profile page rather than an inline picker. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		searchProviders,
		type ProviderSearchData,
		type ProviderSearchSort
	} from '$lib/api/providers';
	import { getFamilyOnboardingState, type FamilyOnboardingState } from '$lib/api/onboarding';
	import { getProfile } from '$lib/api/provider-profile';
	import { listLiveCatalogue } from '$lib/api/service-catalogue';
	import { reportUserSearch } from '$lib/api/user-searches';
	import FamilyGettingStartedModal from '$lib/components/FamilyGettingStartedModal.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import ProviderCard from '$lib/components/ProviderCard.svelte';
	import RequestSearchHelpModal from '$lib/components/RequestSearchHelpModal.svelte';
	import { centsToDollars, dollarsToCents } from '$lib/money';
	import { toast } from '$lib/toast.svelte';
	import { withQuery } from '$lib/nav';
	import { startTourOnce } from '$lib/tour';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	const RADIUS_PRESETS = [10, 25, 50];
	const PER_PAGE = 18;

	const TOUR_KEY = 'poppynz-tour-family-find-v1';
	const TOUR_STEPS = [
		{
			selector: '[data-tour="search"]',
			title: 'Search anything',
			description: 'Look up services, helper names, or keywords — "newborn", "after school pickup"…'
		},
		{
			selector: '[data-tour="radius"]',
			title: 'Search near home',
			description:
				'Results center on your saved home location. Widen the radius to see more helpers.'
		},
		{
			selector: '[data-tour="filters"]',
			title: 'Narrow it down',
			description: 'Filter by service, hourly rate, or city.'
		},
		{
			selector: '[data-tour="filters-mobile"]',
			title: 'Narrow it down',
			description: 'Filter by service, hourly rate, or city.'
		},
		{
			selector: '[data-tour="sort"]',
			title: 'Order results',
			description: 'Sort by distance, price, or newest.'
		},
		{
			selector: '[data-tour="results"]',
			title: 'Vetted helpers',
			description:
				'Everyone listed passed Poppynz identity and background checks. Tap a card for the full profile.'
		}
	];

	// --- applied search state (initialized from the URL, mirrored back to it) ---
	const initial = page.url.searchParams;
	const initialQ = initial.get('q') ?? '';
	const initialService = initial.get('service') ?? '';
	const initialCity = initial.get('city') ?? '';
	const initialMin = initial.get('min') ? Number(initial.get('min')) || null : null;
	const initialMax = initial.get('max') ? Number(initial.get('max')) || null : null;
	const cameFromUrl = initial.size > 0;

	let q = $state(initialQ);
	let service = $state(initialService);
	let city = $state(initialCity);
	let radiusKm = $state<number | null>(
		initial.get('radiusKm') ? Number(initial.get('radiusKm')) || null : null
	);
	let minCents = $state<number | null>(initialMin);
	let maxCents = $state<number | null>(initialMax);
	let sort = $state<ProviderSearchSort>(
		(['relevance', 'distance', 'price_asc', 'price_desc', 'newest'] as const).find(
			(value) => value === initial.get('sort')
		) ?? 'relevance'
	);
	let pageNumber = $state(Math.max(1, Number(initial.get('page')) || 1));

	// --- draft inputs (applied on submit/blur) ---
	let qInput = $state(initialQ);
	let rateMinInput = $state(initialMin == null ? '' : centsToDollars(initialMin));
	let rateMaxInput = $state(initialMax == null ? '' : centsToDollars(initialMax));
	let serviceQuery = $state('');
	let sheetOpen = $state(false);

	// --- family home location (search origin) ---
	let profileLoaded = $state(false);
	let hasLocation = $state(false);
	let originLabel = $state('');

	// --- service catalogue (filter options) ---
	let catalogueNames = $state<Array<string>>([]);

	// --- results ---
	let loading = $state(true);
	let searchError = $state(false);
	let data = $state<ProviderSearchData | null>(null);
	let retryTick = $state(0);
	let requestId = 0;

	// --- getting-started modal (landing checklist) + one-time tour ---
	let onboarding = $state<FamilyOnboardingState | null>(null);
	let modalOpen = $state(false);
	let modalDecided = $state(false);
	let tourStarted = false;

	const dismissKey = (userId: string) => `poppynz-family-getting-started:${userId}`;

	function dismissModal() {
		if (onboarding) localStorage.setItem(dismissKey(onboarding.userId), '1');
		modalOpen = false;
	}

	onMount(() => {
		void getFamilyOnboardingState().then((result) => {
			if (result.ok) {
				onboarding = result.data;
				const incomplete = result.data.progress.completed < result.data.progress.total;
				if (incomplete && !localStorage.getItem(dismissKey(result.data.userId))) {
					modalOpen = true;
				}
			}
			modalDecided = true;
		});
	});

	// The tour waits for a settled page (results rendered, modal out of the
	// way) so its anchors exist; it self-limits to one run via TOUR_KEY.
	$effect(() => {
		if (tourStarted || loading || !profileLoaded || !modalDecided || modalOpen) return;
		tourStarted = true;
		startTourOnce(TOUR_KEY, TOUR_STEPS);
	});

	onMount(() => {
		void getProfile().then((result) => {
			if (result.ok) {
				// The profile response never exposes lat/lng; a saved googlePlaceId
				// means the API has coordinates for radius search.
				const profile = result.data as {
					city?: string | null;
					stateProvince?: string | null;
					googlePlaceId?: string | null;
				};
				hasLocation = Boolean(profile.googlePlaceId);
				originLabel = [profile.city, profile.stateProvince].filter(Boolean).join(', ');
				// Nearby-first default: families with a saved location start on a
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
		if (minCents != null) params.set('min', String(minCents));
		if (maxCents != null) params.set('max', String(maxCents));
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
		void goto(withQuery(resolve('/family/find'), snapshot), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		void searchProviders({
			q: q || undefined,
			service: service || undefined,
			city: city || undefined,
			radiusKm: radiusKm ?? undefined,
			minHourlyRateCents: minCents ?? undefined,
			maxHourlyRateCents: maxCents ?? undefined,
			sort,
			page: pageNumber,
			perPage: PER_PAGE
		}).then((result) => {
			if (id !== requestId) return;
			loading = false;
			if (result.ok) {
				data = result.data;
			} else {
				searchError = true;
			}
		});
	});

	const total = $derived(data?.pagination.total ?? 0);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)));
	const filtersActive = $derived(
		Boolean(q || service || city || minCents != null || maxCents != null)
	);
	const activeFilterCount = $derived(
		[q, service, city, minCents != null || maxCents != null ? 'rate' : ''].filter(Boolean).length
	);
	const filteredCatalogue = $derived(
		catalogueNames.filter((name) => name.toLowerCase().includes(serviceQuery.trim().toLowerCase()))
	);
	// Free-form escape hatch (updated 13b/13c): typed text becomes an exact
	// service filter — providers write their own service names, so the
	// catalogue list can never be complete. Hidden when the text already
	// matches a catalogue entry.
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

	function applyRates() {
		minCents = rateMinInput.trim() === '' ? null : dollarsToCents(rateMinInput);
		maxCents = rateMaxInput.trim() === '' ? null : dollarsToCents(rateMaxInput);
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
		minCents = null;
		maxCents = null;
		rateMinInput = '';
		rateMaxInput = '';
		resetToFirstPage();
	}

	function expandRadius() {
		const next = RADIUS_PRESETS.find((preset) => preset > (radiusKm ?? 0));
		if (next) pickRadius(next);
	}

	// --- "get help from our team" modal (no-results escape hatch) ---
	let assistOpen = $state(false);
	let assistBusy = $state(false);

	async function submitSearchAssist() {
		if (assistBusy) return;
		assistBusy = true;
		// Prefer the applied keyword, but text typed without hitting Search is
		// still what the family was looking for — capture it too.
		const keyword = q || qInput.trim();
		const result = await reportUserSearch({
			...(keyword ? { q: keyword } : {}),
			...(service ? { service } : {}),
			...(city ? { city } : {}),
			...(radiusKm != null ? { radiusKm } : {}),
			...(minCents != null ? { minHourlyRateCents: minCents } : {}),
			...(maxCents != null ? { maxHourlyRateCents: maxCents } : {}),
			sort
		});
		assistBusy = false;
		if (result.ok) {
			assistOpen = false;
			toast.success('Our team has been notified and will reach out to help with your search.');
		} else {
			toast.error(result.error.message || 'Please try again in a moment.', {
				title: "Couldn't notify our team"
			});
		}
	}

	const rateChipLabel = $derived.by(() => {
		if (minCents != null && maxCents != null)
			return `$${centsToDollars(minCents)}–$${centsToDollars(maxCents)}/hr`;
		if (minCents != null) return `From $${centsToDollars(minCents)}/hr`;
		if (maxCents != null) return `Up to $${centsToDollars(maxCents)}/hr`;
		return '';
	});

	function detailQs(distanceKm: number | undefined): string {
		const params = new SvelteURLSearchParams();
		if (qs) params.set('from', qs);
		if (distanceKm !== undefined) params.set('d', String(distanceKm));
		return params.toString();
	}
</script>

<svelte:head>
	<title>Find help · Poppynz</title>
</svelte:head>

{#snippet filterControls()}
	<!-- Service facet: single-select — the search API filters one service at a time. -->
	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">Service</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Service
		</div>
		<label class="input input-sm mb-2 flex w-full items-center gap-2">
			<i class="las la-search text-outline" aria-hidden="true"></i>
			<input type="search" class="grow" placeholder="Filter services…" bind:value={serviceQuery} />
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
						Select to search for this exact service
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
					<p class="px-1 py-1 text-xs text-base-content-muted">No services match.</p>
				{/if}
			{/each}
		</div>
	</fieldset>

	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">Hourly rate</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Hourly rate (CAD)
		</div>
		<div class="flex items-center gap-2">
			<label class="input input-sm flex min-w-0 flex-1 items-center gap-1">
				<span class="text-base-content-muted">$</span>
				<input
					type="text"
					inputmode="decimal"
					class="w-full min-w-0"
					placeholder="20"
					aria-label="Minimum hourly rate"
					bind:value={rateMinInput}
					onchange={applyRates}
				/>
			</label>
			<span class="text-xs text-base-content-muted">to</span>
			<label class="input input-sm flex min-w-0 flex-1 items-center gap-1">
				<span class="text-base-content-muted">$</span>
				<input
					type="text"
					inputmode="decimal"
					class="w-full min-w-0"
					placeholder="45"
					aria-label="Maximum hourly rate"
					bind:value={rateMaxInput}
					onchange={applyRates}
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">City</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">City</div>
		<select
			class="select select-sm w-full"
			aria-label="City"
			value={city}
			onchange={(event) => selectCity(event.currentTarget.value)}
		>
			<option value="">All cities</option>
			{#each cityOptions as option (option.value)}
				<option value={option.value}>
					{option.value}{option.count ? ` (${option.count})` : ''}
				</option>
			{/each}
		</select>
	</fieldset>

	<div class="rounded-xl bg-success-content p-4 text-[13px] leading-relaxed text-success">
		<i class="las la-user-shield mr-1" aria-hidden="true"></i>
		Everyone you see here has been identity- and background-vetted by Poppynz.
	</div>
{/snippet}

<div class="mx-auto flex max-w-6xl flex-col gap-5">
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
					placeholder="Search by service, name or keyword…"
					aria-label="Search providers"
					bind:value={qInput}
				/>
			</label>
			<button type="submit" class="btn btn-primary lg:w-auto">Search</button>
		</div>

		<div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
			<div class="flex min-w-0 items-center gap-1.5 text-sm text-base-content-muted">
				<i class="las la-map-marker text-neutral" aria-hidden="true"></i>
				{#if !profileLoaded}
					<span class="skeleton h-4 w-40"></span>
				{:else if city}
					<span class="truncate">In <strong class="text-base-content">{city}</strong></span>
					{#if hasLocation}
						<button
							type="button"
							class="shrink-0 text-xs font-semibold text-primary"
							onclick={() => selectCity('')}
						>
							Search near me
						</button>
					{/if}
				{:else if hasLocation}
					<span class="truncate">Near <strong class="text-base-content">{originLabel}</strong></span
					>
					<a href={resolve('/family/profile')} class="shrink-0 text-xs font-semibold text-primary">
						Change
					</a>
				{:else}
					<span>No home location saved.</span>
					<a href={resolve('/family/profile')} class="shrink-0 text-xs font-semibold text-primary">
						Set your location
					</a>
				{/if}
			</div>

			<div class="join" role="group" aria-label="Search radius" data-tour="radius">
				<button
					type="button"
					class="btn join-item btn-sm {radiusKm == null
						? 'btn-secondary'
						: 'btn-ghost border border-outline-variant'}"
					onclick={() => pickRadius(null)}
				>
					Anywhere
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
						{preset} km
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
						Searching…
					{:else}
						{total} vetted {total === 1 ? 'helper' : 'helpers'}{radiusKm != null
							? ' near you'
							: city
								? ` in ${city}`
								: ''}
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
						Filters
						{#if activeFilterCount > 0}
							<span
								class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center
									rounded-full bg-accent text-[10px] font-bold text-accent-content"
							>
								{activeFilterCount}
							</span>
						{/if}
					</button>
					<label class="flex items-center gap-1.5 text-xs text-base-content-muted" data-tour="sort">
						Sort by
						<select class="select select-sm w-auto" bind:value={sort} onchange={resetToFirstPage}>
							<option value="relevance">Relevance</option>
							{#if radiusKm != null}
								<option value="distance">Distance (nearest)</option>
							{/if}
							<option value="price_asc">Price: low to high</option>
							<option value="price_desc">Price: high to low</option>
							<option value="newest">Newest</option>
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
					{#if rateChipLabel}
						<button
							type="button"
							class="badge gap-1 border-none bg-base-400 text-secondary"
							onclick={() => {
								minCents = null;
								maxCents = null;
								rateMinInput = '';
								rateMaxInput = '';
								resetToFirstPage();
							}}
						>
							{rateChipLabel} <i class="las la-times" aria-hidden="true"></i>
						</button>
					{/if}
					<button type="button" class="text-xs font-semibold text-primary" onclick={clearFilters}>
						Clear all
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
						Something went wrong on our side
					</h2>
					<p class="max-w-sm text-sm text-base-content-muted">
						Your search didn't load. Your filters are safe — try again in a moment.
					</p>
					<button
						type="button"
						class="btn btn-primary btn-sm"
						onclick={() => (retryTick = retryTick + 1)}
					>
						<i class="las la-redo-alt" aria-hidden="true"></i>
						Retry search
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
						No helpers match this search
					</h2>
					<p class="max-w-sm text-sm text-base-content-muted">
						{#if city}
							Try another city, removing a filter, or searching a different term.
						{:else}
							Try widening your radius, removing a filter, or searching a different term.
						{/if}
					</p>
					<div class="flex flex-wrap justify-center gap-2">
						{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
							<button type="button" class="btn btn-primary btn-sm" onclick={expandRadius}>
								Expand radius to {RADIUS_PRESETS.find((preset) => preset > (radiusKm ?? 0))} km
							</button>
						{:else if city && hasLocation}
							<button type="button" class="btn btn-primary btn-sm" onclick={() => selectCity('')}>
								Search near me instead
							</button>
						{/if}
						<button type="button" class="btn btn-sm" onclick={clearFilters}>Clear filters</button>
					</div>
					<div
						class="mt-2 flex w-full max-w-sm flex-col items-center gap-2 border-t
							border-card-border pt-4"
					>
						<p class="text-xs text-base-content-muted">
							Still stuck? Tell us — a Poppynz administrator will be informed of your search and
							reach out to help.
						</p>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={() => (assistOpen = true)}
						>
							<i class="las la-hands-helping" aria-hidden="true"></i>
							Get help from our team
						</button>
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
						We're growing in your area
					</h2>
					<p class="max-w-sm text-sm text-base-content-muted">
						Poppynz is new around here — vetted helpers near you are joining every week. Widen the
						radius to see who's a little further out.
					</p>
					{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={() => pickRadius(RADIUS_PRESETS[RADIUS_PRESETS.length - 1])}
						>
							Search within {RADIUS_PRESETS[RADIUS_PRESETS.length - 1]} km
						</button>
					{/if}
				</div>
			{:else if data}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{#each data.providers as provider (provider.userId)}
						<ProviderCard
							{provider}
							href={withQuery(
								resolve('/family/providers/[userId]', { userId: provider.userId }),
								detailQs(provider.distanceKm)
							)}
						/>
					{/each}
				</div>

				<div class="mt-6">
					<Pagination
						page={pageNumber}
						{totalPages}
						label="Search result pages"
						onselect={(next) => (pageNumber = next)}
					/>
				</div>
			{/if}
		</section>
	</div>
</div>

{#if onboarding}
	<FamilyGettingStartedModal open={modalOpen} state={onboarding} onclose={dismissModal} />
{/if}

<RequestSearchHelpModal
	open={assistOpen}
	busy={assistBusy}
	onconfirm={submitSearchAssist}
	oncancel={() => (assistOpen = false)}
/>

<!-- Mobile filter bottom sheet -->
{#if sheetOpen}
	<div
		class="modal modal-bottom modal-open lg:hidden"
		role="dialog"
		aria-modal="true"
		aria-label="Filters"
	>
		<div class="modal-box rounded-t-2xl">
			<div class="mx-auto mb-3 h-1 w-10 rounded-pill bg-outline-variant"></div>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="font-display text-lg font-bold text-base-content">Filters</h2>
				<button type="button" class="text-xs font-semibold text-primary" onclick={clearFilters}>
					Clear all
				</button>
			</div>
			<div class="flex flex-col gap-3">
				{#if hasLocation}
					<div class="join" role="group" aria-label="Search radius">
						<button
							type="button"
							class="btn join-item btn-sm {radiusKm == null
								? 'btn-secondary'
								: 'btn-ghost border border-outline-variant'}"
							onclick={() => pickRadius(null)}
						>
							Anywhere
						</button>
						{#each RADIUS_PRESETS as preset (preset)}
							<button
								type="button"
								class="btn join-item btn-sm {radiusKm === preset
									? 'btn-secondary'
									: 'btn-ghost border border-outline-variant'}"
								onclick={() => pickRadius(preset)}
							>
								{preset} km
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
						Show {total} {total === 1 ? 'helper' : 'helpers'}
					{/if}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (sheetOpen = false)}
			aria-label="Close filters"
		></button>
	</div>
{/if}
