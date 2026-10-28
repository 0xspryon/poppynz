<script lang="ts">
	import { formatPlace } from '$lib/location';
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
	import {
		dismissFamilyWelcome,
		getFamilyOnboardingState,
		type FamilyOnboardingState
	} from '$lib/api/onboarding';
	import { getReplacementContext, type ReplacementContext } from '$lib/api/contracts';
	import { getProfile } from '$lib/api/provider-profile';
	import { listLiveCatalogue } from '$lib/api/service-catalogue';
	import { reportUserSearch } from '$lib/api/user-searches';
	import FamilyGettingStartedModal from '$lib/components/FamilyGettingStartedModal.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import ProviderCard from '$lib/components/ProviderCard.svelte';
	import RequestSearchHelpModal from '$lib/components/RequestSearchHelpModal.svelte';
	import ReplacementBanner from '$lib/components/replacement/ReplacementBanner.svelte';
	import { centsToDollars, dollarsToCents, formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { withQuery } from '$lib/nav';
	import {
		readReplacementParams,
		replacementErrorMessage,
		writeReplacementParams
	} from '$lib/replacement';
	import { startTourOnce } from '$lib/tour';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	const RADIUS_PRESETS = [10, 25, 50];
	const PER_PAGE = 18;

	const TOUR_KEY = 'poppynz-tour-family-find-v1';
	const TOUR_STEPS = [
		{
			selector: '[data-tour="search"]',
			title: m.family_find_tour_search_title(),
			description: m.family_find_tour_search_body()
		},
		{
			selector: '[data-tour="radius"]',
			title: m.family_find_tour_radius_title(),
			description: m.family_find_tour_radius_body()
		},
		{
			selector: '[data-tour="filters"]',
			title: m.family_find_tour_filters_title(),
			description: m.family_find_tour_filters_body()
		},
		{
			selector: '[data-tour="filters-mobile"]',
			title: m.family_find_tour_filters_title(),
			description: m.family_find_tour_filters_body()
		},
		{
			selector: '[data-tour="sort"]',
			title: m.family_find_tour_sort_title(),
			description: m.family_find_tour_sort_body()
		},
		{
			selector: '[data-tour="results"]',
			title: m.family_find_tour_results_title(),
			description: m.family_find_tour_results_body()
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

	// --- Find a replacement (Tier 3 step 1b): a helper cancelled; search for
	// another one offering the same service, without them, and carry the
	// context to the profile where the contract can be used as a template. ---
	const initialReplacement = readReplacementParams(initial);
	let replacement = $state(initialReplacement);
	let replacementContext = $state<ReplacementContext | null>(null);
	// The first search waits for the context, so the helper who cancelled
	// never flashes into the results.
	let replacementReady = $state(initialReplacement === null);

	onMount(() => {
		const wanted = initialReplacement;
		if (!wanted) return;
		void getReplacementContext(wanted.contractId, wanted.sessionIds).then((result) => {
			if (result.ok) {
				replacementContext = result.data.replacement;
				const serviceName = result.data.replacement.sessions[0]?.serviceName;
				if (!service && serviceName) service = serviceName;
			} else {
				// Not replaceable any more (started, or not found): a regular search.
				toast.error(
					result.error.code === 'REPLACEMENT_SESSIONS_INVALID' ||
						result.error.code === 'CONTRACT_NOT_FOUND'
						? replacementErrorMessage(result.error, '')
						: m.replacement_context_error()
				);
				replacement = null;
			}
			replacementReady = true;
		});
	});

	function exitReplacement() {
		replacement = null;
		replacementContext = null;
		resetToFirstPage();
	}

	// --- family home location (search origin) ---
	let profileLoaded = $state(false);
	let hasLocation = $state(false);
	let originLabel = $state('');

	// --- service catalogue (filter options) ---
	let catalogueNames = $state<Array<string>>([]);

	// --- results ---
	let loading = $state(true);
	let searchError = $state(false);
	// Families browse helpers only once approved (mirrors the helper side);
	// the API answers FAMILY_NOT_APPROVED until then, rendered as its own state.
	let notApproved = $state(false);
	let data = $state<ProviderSearchData | null>(null);
	let retryTick = $state(0);
	let requestId = 0;

	// --- getting-started modal (landing checklist) + one-time tour ---
	let onboarding = $state<FamilyOnboardingState | null>(null);
	let modalOpen = $state(false);
	let modalDecided = $state(false);
	let tourStarted = false;

	// UAT #16: the server decides (dismissed, finished or already submitted)
	// and remembers the dismissal across devices — no localStorage.
	function dismissModal() {
		modalOpen = false;
		void dismissFamilyWelcome();
	}

	onMount(() => {
		void getFamilyOnboardingState().then((result) => {
			if (result.ok) {
				onboarding = result.data;
				modalOpen = result.data.welcome.show;
			}
			modalDecided = true;
		});
	});

	// The tour waits for a settled page (results rendered, modal out of the
	// way) so its anchors exist; it self-limits to one run via TOUR_KEY.
	$effect(() => {
		if (tourStarted || loading || !profileLoaded || !modalDecided || modalOpen || notApproved)
			return;
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
				originLabel = formatPlace(profile.city, profile.stateProvince) ?? '';
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
		writeReplacementParams(params, replacement);
		return params.toString();
	});

	$effect(() => {
		if (!profileLoaded || !replacementReady) return;
		void retryTick;
		const excludeUserId = replacementContext?.helper.userId;
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
			perPage: PER_PAGE,
			excludeUserId
		}).then((result) => {
			if (id !== requestId) return;
			loading = false;
			if (result.ok) {
				notApproved = false;
				data = result.data;
			} else if (result.error.code === 'FAMILY_NOT_APPROVED') {
				notApproved = true;
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
			toast.success(m.family_find_assist_success());
		} else {
			toast.error(m.family_find_assist_error_body(), {
				title: m.family_find_assist_error_title()
			});
		}
	}

	const rateChipLabel = $derived.by(() => {
		if (minCents != null && maxCents != null)
			return m.money_per_hour({
				amount: m.money_range({ min: formatMoney(minCents), max: formatMoney(maxCents) })
			});
		if (minCents != null)
			return m.family_find_rate_from({
				amount: m.money_per_hour({ amount: formatMoney(minCents) })
			});
		if (maxCents != null)
			return m.family_find_rate_up_to({
				amount: m.money_per_hour({ amount: formatMoney(maxCents) })
			});
		return '';
	});

	function detailQs(distanceKm: number | undefined): string {
		const params = new SvelteURLSearchParams();
		if (qs) params.set('from', qs);
		if (distanceKm !== undefined) params.set('d', String(distanceKm));
		writeReplacementParams(params, replacement);
		return params.toString();
	}
</script>

<svelte:head>
	<title>{m.family_find_page_title()}</title>
</svelte:head>

{#snippet filterControls()}
	<!-- Service facet: single-select — the search API filters one service at a time. -->
	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">{m.family_find_service()}</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.family_find_service()}
		</div>
		<label class="input input-sm mb-2 flex w-full items-center gap-2">
			<i class="las la-search text-outline" aria-hidden="true"></i>
			<input
				type="search"
				class="grow"
				placeholder={m.family_find_filter_services_placeholder()}
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
						{m.family_find_exact_service_hint()}
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
						{m.family_find_no_services_match()}
					</p>
				{/if}
			{/each}
		</div>
	</fieldset>

	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">{m.family_find_hourly_rate()}</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.family_find_hourly_rate_cad()}
		</div>
		<div class="flex items-center gap-2">
			<label class="input input-sm flex min-w-0 flex-1 items-center gap-1">
				<span class="text-base-content-muted">$</span>
				<input
					type="text"
					inputmode="decimal"
					class="w-full min-w-0"
					placeholder="20"
					aria-label={m.family_find_min_rate()}
					bind:value={rateMinInput}
					onchange={applyRates}
				/>
			</label>
			<span class="text-xs text-base-content-muted">{m.family_find_rate_to()}</span>
			<label class="input input-sm flex min-w-0 flex-1 items-center gap-1">
				<span class="text-base-content-muted">$</span>
				<input
					type="text"
					inputmode="decimal"
					class="w-full min-w-0"
					placeholder="45"
					aria-label={m.family_find_max_rate()}
					bind:value={rateMaxInput}
					onchange={applyRates}
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="min-w-0 rounded-xl border border-card-border bg-base-100 p-4">
		<legend class="sr-only">{m.family_find_city()}</legend>
		<div class="mb-2 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.family_find_city()}
		</div>
		<select
			class="select select-sm w-full"
			aria-label={m.family_find_city()}
			value={city}
			onchange={(event) => selectCity(event.currentTarget.value)}
		>
			<option value="">{m.family_find_all_cities()}</option>
			{#each cityOptions as option (option.value)}
				<option value={option.value}>
					{option.value}{option.count ? ` (${option.count})` : ''}
				</option>
			{/each}
		</select>
	</fieldset>

	<div class="rounded-xl bg-success-content p-4 text-[13px] leading-relaxed text-success">
		<i class="las la-user-shield mr-1" aria-hidden="true"></i>
		{m.family_find_vetted_note()}
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
				{m.family_find_not_approved_title()}
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				{m.family_find_not_approved_body()}
			</p>
			<a href={resolve('/family/approval')} class="btn btn-primary btn-sm">
				{m.family_find_check_approval()}
			</a>
		</div>
	{:else}
		{#if replacementContext}
			<ReplacementBanner context={replacementContext} showHidden>
				{#snippet actions()}
					<button
						type="button"
						class="text-xs font-semibold text-primary"
						onclick={exitReplacement}
						data-testid="replacement-exit"
					>
						{m.replacement_find_exit()}
					</button>
				{/snippet}
			</ReplacementBanner>
		{/if}
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
						placeholder={m.family_find_search_placeholder()}
						aria-label={m.family_find_search_aria()}
						bind:value={qInput}
					/>
				</label>
				<button type="submit" class="btn btn-primary lg:w-auto">
					{m.family_find_search_button()}
				</button>
			</div>

			<div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
				<div class="flex min-w-0 items-center gap-1.5 text-sm text-base-content-muted">
					<i class="las la-map-marker text-neutral" aria-hidden="true"></i>
					{#if !profileLoaded}
						<span class="skeleton h-4 w-40"></span>
					{:else if city}
						<span class="truncate"
							>{m.family_find_location_in_before()}
							<strong class="text-base-content">{city}</strong></span
						>
						{#if hasLocation}
							<button
								type="button"
								class="shrink-0 text-xs font-semibold text-primary"
								onclick={() => selectCity('')}
							>
								{m.family_find_search_near_me()}
							</button>
						{/if}
					{:else if hasLocation}
						<span class="truncate"
							>{m.family_find_location_near_before()}
							<strong class="text-base-content">{originLabel}</strong></span
						>
						<a
							href={resolve('/family/profile')}
							class="shrink-0 text-xs font-semibold text-primary"
						>
							{m.family_find_change_location()}
						</a>
					{:else}
						<span>{m.family_find_no_location()}</span>
						<a
							href={resolve('/family/profile')}
							class="shrink-0 text-xs font-semibold text-primary"
						>
							{m.family_find_set_location()}
						</a>
					{/if}
				</div>

				<div class="join" role="group" aria-label={m.family_find_radius_aria()} data-tour="radius">
					<button
						type="button"
						class="btn join-item btn-sm {radiusKm == null
							? 'btn-secondary'
							: 'btn-ghost border border-outline-variant'}"
						onclick={() => pickRadius(null)}
					>
						{m.family_find_anywhere()}
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
							{m.family_find_searching()}
						{:else if radiusKm != null}
							{m.family_find_results_count_near({ count: total })}
						{:else if city}
							{m.family_find_results_count_city({ count: total, city })}
						{:else}
							{m.family_find_results_count({ count: total })}
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
							{m.family_find_filters()}
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
							{m.family_find_sort_by()}
							<select class="select select-sm w-auto" bind:value={sort} onchange={resetToFirstPage}>
								<option value="relevance">{m.family_find_sort_relevance()}</option>
								{#if radiusKm != null}
									<option value="distance">{m.family_find_sort_distance()}</option>
								{/if}
								<option value="price_asc">{m.family_find_sort_price_asc()}</option>
								<option value="price_desc">{m.family_find_sort_price_desc()}</option>
								<option value="newest">{m.family_find_sort_newest()}</option>
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
							{m.family_find_clear_all()}
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
							{m.family_find_error_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{m.family_find_error_body()}
						</p>
						<button
							type="button"
							class="btn btn-primary btn-sm"
							onclick={() => (retryTick = retryTick + 1)}
						>
							<i class="las la-redo-alt" aria-hidden="true"></i>
							{m.family_find_retry_search()}
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
							{m.family_find_no_match_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{#if city}
								{m.family_find_no_match_body_city()}
							{:else}
								{m.family_find_no_match_body()}
							{/if}
						</p>
						<div class="flex flex-wrap justify-center gap-2">
							{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
								<button type="button" class="btn btn-primary btn-sm" onclick={expandRadius}>
									{m.family_find_expand_radius({
										km: RADIUS_PRESETS.find((preset) => preset > (radiusKm ?? 0)) ?? 0
									})}
								</button>
							{:else if city && hasLocation}
								<button type="button" class="btn btn-primary btn-sm" onclick={() => selectCity('')}>
									{m.family_find_search_near_me_instead()}
								</button>
							{/if}
							<button type="button" class="btn btn-sm" onclick={clearFilters}>
								{m.family_find_clear_filters()}
							</button>
						</div>
						<div
							class="mt-2 flex w-full max-w-sm flex-col items-center gap-2 border-t
							border-card-border pt-4"
						>
							<p class="text-xs text-base-content-muted">
								{m.family_find_still_stuck()}
							</p>
							<button
								type="button"
								class="btn btn-primary btn-sm"
								onclick={() => (assistOpen = true)}
							>
								<i class="las la-hands-helping" aria-hidden="true"></i>
								{m.family_find_get_help()}
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
							{m.family_find_growing_title()}
						</h2>
						<p class="max-w-sm text-sm text-base-content-muted">
							{m.family_find_growing_body()}
						</p>
						{#if hasLocation && radiusKm != null && radiusKm < RADIUS_PRESETS[RADIUS_PRESETS.length - 1]}
							<button
								type="button"
								class="btn btn-primary btn-sm"
								onclick={() => pickRadius(RADIUS_PRESETS[RADIUS_PRESETS.length - 1])}
							>
								{m.family_find_search_within({ km: RADIUS_PRESETS[RADIUS_PRESETS.length - 1] })}
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
							label={m.family_find_pagination_label()}
							onselect={(next) => (pageNumber = next)}
						/>
					</div>
				{/if}
			</section>
		</div>
	{/if}
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
{#if sheetOpen && !notApproved}
	<div
		class="modal modal-bottom modal-open lg:hidden"
		role="dialog"
		aria-modal="true"
		aria-label={m.family_find_filters()}
	>
		<div class="modal-box rounded-t-2xl">
			<div class="mx-auto mb-3 h-1 w-10 rounded-pill bg-outline-variant"></div>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="font-display text-lg font-bold text-base-content">
					{m.family_find_filters()}
				</h2>
				<button type="button" class="text-xs font-semibold text-primary" onclick={clearFilters}>
					{m.family_find_clear_all()}
				</button>
			</div>
			<div class="flex flex-col gap-3">
				{#if hasLocation}
					<div class="join" role="group" aria-label={m.family_find_radius_aria()}>
						<button
							type="button"
							class="btn join-item btn-sm {radiusKm == null
								? 'btn-secondary'
								: 'btn-ghost border border-outline-variant'}"
							onclick={() => pickRadius(null)}
						>
							{m.family_find_anywhere()}
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
						{m.family_find_show_helpers({ count: total })}
					{/if}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (sheetOpen = false)}
			aria-label={m.family_find_close_filters()}
		></button>
	</div>
{/if}
