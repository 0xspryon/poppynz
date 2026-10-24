<script lang="ts">
	/** Searches families flagged for follow-up from the find page's no-results
	 * state. Newest first, server-paginated; each card shows who searched, when,
	 * and the full filter set so an admin can reach out with suggestions. */
	import {
		listAdminUserSearches,
		type AdminUserSearch,
		type AdminUserSearchList
	} from '$lib/api/admin-user-searches';
	import Pagination from '$lib/components/Pagination.svelte';
	import { formatNumber, intlLocale } from '$lib/locale';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';

	const PER_PAGE = 20;

	let pageNumber = $state(1);
	let loading = $state(true);
	let errorMessage = $state('');
	let data = $state<AdminUserSearchList | null>(null);
	let requestId = 0;

	$effect(() => {
		const requestedPage = pageNumber;
		const id = ++requestId;
		loading = true;
		errorMessage = '';
		void listAdminUserSearches(requestedPage, PER_PAGE).then((result) => {
			if (id !== requestId) return;
			loading = false;
			if (result.ok) {
				data = result.data;
			} else {
				errorMessage =
					result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHORIZED'
						? m.admin_searches_error_forbidden()
						: m.common_error_generic();
			}
		});
	});

	const total = $derived(data?.pagination.total ?? 0);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)));

	function initials(search: AdminUserSearch): string {
		const parts = search.userName.split(' ').filter(Boolean);
		const letters = parts.map((part) => part.charAt(0)).join('');
		return (letters || search.userEmail.charAt(0)).slice(0, 2).toUpperCase();
	}

	function searchedText(search: AdminUserSearch): string {
		return new Date(search.createdAt).toLocaleString(intlLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function sortLabel(sort: string): string {
		switch (sort) {
			case 'relevance':
				return m.admin_searches_sort_relevance();
			case 'distance':
				return m.admin_searches_sort_distance();
			case 'price_asc':
				return m.admin_searches_sort_price_asc();
			case 'price_desc':
				return m.admin_searches_sort_price_desc();
			case 'newest':
				return m.admin_searches_sort_newest();
			default:
				return sort;
		}
	}

	/** "Mission, BC" from the location snapshot taken at search time. */
	function locationLabel(search: AdminUserSearch): string {
		const location = search.details.location;
		if (!location) return '';
		return (
			[location.city, location.stateProvince].filter(Boolean).join(', ') || location.country || ''
		);
	}

	/** The filter set as display chips, mirroring the find page's chip row. */
	function filterChips(search: AdminUserSearch): Array<string> {
		const details = search.details;
		const chips: Array<string> = [];
		if (details.q) chips.push(m.admin_searches_chip_query({ query: details.q }));
		if (details.service) chips.push(details.service);
		if (details.city) chips.push(m.admin_searches_chip_city({ city: details.city }));
		if (details.radiusKm != null)
			chips.push(m.admin_searches_chip_radius({ km: formatNumber(details.radiusKm) }));
		if (details.minHourlyRateCents != null && details.maxHourlyRateCents != null) {
			chips.push(
				m.admin_searches_chip_rate_range({
					min: formatMoney(details.minHourlyRateCents),
					max: formatMoney(details.maxHourlyRateCents)
				})
			);
		} else if (details.minHourlyRateCents != null) {
			chips.push(
				m.admin_searches_chip_rate_from({ amount: formatMoney(details.minHourlyRateCents) })
			);
		} else if (details.maxHourlyRateCents != null) {
			chips.push(
				m.admin_searches_chip_rate_up_to({ amount: formatMoney(details.maxHourlyRateCents) })
			);
		}
		if (details.sort) chips.push(m.admin_searches_chip_sort({ label: sortLabel(details.sort) }));
		return chips;
	}
</script>

<svelte:head>
	<title>{m.admin_searches_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
				{m.admin_searches_heading()}
			</h1>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.admin_searches_subheading()}
			</p>
		</div>
		{#if !loading && !errorMessage}
			<span class="text-sm text-base-content-muted">
				{m.admin_searches_count({ count: total })}
			</span>
		{/if}
	</div>

	<div class="mt-4">
		{#if loading}
			<div class="flex justify-center py-24">
				<span class="loading loading-spinner loading-lg text-primary"></span>
			</div>
		{:else if errorMessage}
			<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
		{:else if !data || data.searches.length === 0}
			<p
				class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm
					text-base-content-muted"
			>
				{m.admin_searches_empty()}
			</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each data.searches as search (search.id)}
					<div class="rounded-[10px] border border-card-border bg-base-100 p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2.5">
								<span
									class="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-base-400
										text-[13px] font-bold text-secondary"
								>
									{initials(search)}
								</span>
								<div class="min-w-0">
									<div class="truncate text-[13.5px] font-semibold text-base-content">
										{search.userName}
									</div>
									<a
										href="mailto:{search.userEmail}"
										class="block truncate text-[11.5px] text-outline hover:text-primary"
									>
										{search.userEmail}
									</a>
								</div>
							</div>
							<div class="flex flex-col items-end gap-0.5">
								<span class="text-[11.5px] whitespace-nowrap text-outline">
									{searchedText(search)}
								</span>
								{#if locationLabel(search)}
									<span class="text-[11.5px] whitespace-nowrap text-outline">
										<i class="las la-map-marker" aria-hidden="true"></i>
										{locationLabel(search)}
									</span>
								{/if}
							</div>
						</div>
						<div class="mt-3 flex flex-wrap items-center gap-1.5">
							{#each filterChips(search) as chip (chip)}
								<span class="badge border-none bg-base-400 text-secondary">{chip}</span>
							{:else}
								<span class="text-xs text-base-content-muted">{m.admin_searches_no_filters()}</span>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<div class="mt-6">
				<Pagination
					page={pageNumber}
					{totalPages}
					label={m.admin_searches_pagination_label()}
					onselect={(next) => (pageNumber = next)}
				/>
			</div>
		{/if}
	</div>
</div>
