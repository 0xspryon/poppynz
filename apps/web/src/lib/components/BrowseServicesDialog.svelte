<script lang="ts">
	/** "All services" browser (provider services page): search + category
	 * filters over the live catalogue, multi-select, add in one go. Owns the
	 * query/filter/selection; emits the selected catalogue ids. */
	import { SvelteSet } from 'svelte/reactivity';
	import type { CatalogueItem } from '$lib/api/service-catalogue';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		catalogue: Array<CatalogueItem>;
		/** Catalogue ids the provider already offers — shown checked and disabled. */
		linkedIds: Set<string>;
		busy?: boolean;
		/** Line under the title; defaults to the provider services copy. */
		subtitle?: string;
		/** Families see base rates as starting prices ("from $20/hr") — helpers
		 * set their own rates above them (UAT #5). */
		ratesAreStartingPrices?: boolean;
		/** Helpers only (U6): their credential per document type, so an item
		 * that requires one (PSW) says so up front — and can't be picked
		 * until it is approved. */
		credentials?: ReadonlyMap<string, { name: string; status: string }> | null;
		onadd: (ids: Array<string>) => void;
		oncancel: () => void;
	}

	let {
		open,
		catalogue,
		linkedIds,
		busy = false,
		subtitle = m.family_browse_default_subtitle(),
		ratesAreStartingPrices = false,
		credentials = null,
		onadd,
		oncancel
	}: Props = $props();

	let query = $state('');
	let category = $state<string | null>(null);
	const selected = new SvelteSet<string>();

	$effect(() => {
		if (open) {
			query = '';
			category = null;
			selected.clear();
		}
	});

	const categories = $derived([...new Set(catalogue.map((item) => item.category))]);
	const items = $derived(
		catalogue.filter(
			(item) =>
				(category === null || item.category === category) &&
				(query.trim() === '' || item.name.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);

	type CredentialHint = { text: string; blocked: boolean; approved: boolean };

	function credentialHint(item: CatalogueItem): CredentialHint | null {
		if (!credentials || !item.requiredDocumentTypeId) return null;
		const entry = credentials.get(item.requiredDocumentTypeId);
		const document = entry?.name ?? m.provider_services_credential_generic();
		if (entry?.status === 'approved') {
			return {
				text: m.provider_services_credential_approved({ document }),
				blocked: false,
				approved: true
			};
		}
		return {
			text:
				entry?.status === 'submitted'
					? m.provider_services_credential_pending({ document })
					: m.provider_services_credential_needed({ document }),
			blocked: true,
			approved: false
		};
	}

	function toggle(item: CatalogueItem) {
		if (linkedIds.has(item.id) || credentialHint(item)?.blocked) return;
		if (selected.has(item.id)) {
			selected.delete(item.id);
		} else {
			selected.add(item.id);
		}
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label={m.family_browse_title()}>
		<div class="modal-box max-w-2xl p-0">
			<div class="px-6 pt-5">
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-bold">{m.family_browse_title()}</h2>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm"
						aria-label={m.common_close()}
						onclick={oncancel}
					>
						<i class="las la-times text-lg" aria-hidden="true"></i>
					</button>
				</div>
				<p class="mt-0.5 mb-3.5 text-[13px] text-base-content-muted">
					{subtitle}
				</p>
				<label class="input mb-3 w-full">
					<i class="las la-search text-base text-outline" aria-hidden="true"></i>
					<input
						type="search"
						placeholder={m.family_browse_search_placeholder()}
						bind:value={query}
					/>
				</label>
				<div class="mb-2 flex flex-wrap gap-1.5">
					<button
						type="button"
						class="rounded-pill px-3.5 py-1.5 text-[11.5px] font-semibold
							{category === null
							? 'bg-secondary text-secondary-content'
							: 'border border-outline-variant bg-base-100 text-base-content-muted'}"
						onclick={() => (category = null)}
					>
						{m.family_browse_all_count({ count: catalogue.length })}
					</button>
					{#each categories as entry (entry)}
						<button
							type="button"
							class="rounded-pill px-3.5 py-1.5 text-[11.5px] font-medium
								{category === entry
								? 'bg-secondary font-semibold text-secondary-content'
								: 'border border-outline-variant bg-base-100 text-base-content-muted'}"
							onclick={() => (category = category === entry ? null : entry)}
						>
							{entry}
						</button>
					{/each}
				</div>
			</div>
			<div class="max-h-80 overflow-y-auto border-t border-base-300">
				{#each items as item (item.id)}
					{@const inList = linkedIds.has(item.id)}
					{@const isSelected = selected.has(item.id)}
					{@const hint = inList ? null : credentialHint(item)}
					<button
						type="button"
						class="flex w-full items-center gap-3 border-b border-base-300 px-5 py-3 text-left
							{isSelected ? 'bg-base-200' : ''}"
						onclick={() => toggle(item)}
						disabled={inList || hint?.blocked === true}
					>
						<span
							class="flex size-5 shrink-0 items-center justify-center rounded-full
								{inList ? 'bg-success' : isSelected ? 'bg-primary' : 'border-[1.5px] border-outline-variant'}"
						>
							{#if inList || isSelected}
								<i class="las la-check text-xs text-primary-content" aria-hidden="true"></i>
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span
								class="text-[13.5px] font-semibold {inList ? 'text-outline' : 'text-base-content'}"
							>
								{item.name}
							</span>
							{#if inList}
								<span class="ml-2 text-[11px] text-success">
									{m.family_browse_already_in_list()}
								</span>
							{/if}
							{#if hint}
								<span
									class="mt-0.5 flex items-center gap-1 text-[11.5px]
										{hint.approved ? 'text-success' : 'text-warning'}"
								>
									<i
										class="las {hint.approved ? 'la-check-circle' : 'la-certificate'} text-sm"
										aria-hidden="true"
									></i>
									{hint.text}
								</span>
							{/if}
						</span>
						<span class="shrink-0 font-display text-[13.5px] font-bold text-secondary">
							{#if ratesAreStartingPrices}<span class="text-[10.5px] font-normal text-outline"
									>{m.family_browse_rate_from()}
								</span>{/if}{formatMoney(item.baseHourlyRateCents)}<span
								class="text-[10.5px] font-normal text-outline">{m.family_browse_per_hour()}</span
							>
						</span>
					</button>
				{:else}
					<p class="px-5 py-6 text-sm text-base-content-muted">
						{m.family_browse_no_match()}
					</p>
				{/each}
			</div>
			<div class="flex items-center justify-between bg-base-200 px-6 py-4">
				<span class="text-[13px] text-base-content-muted">
					{m.family_browse_selected({ count: selected.size })}
				</span>
				<div class="flex gap-2.5">
					<button type="button" class="btn btn-ghost" onclick={oncancel}>{m.common_cancel()}</button
					>
					<button
						type="button"
						class="btn btn-primary"
						disabled={selected.size === 0 || busy}
						onclick={() => onadd([...selected])}
					>
						{#if busy}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						{m.family_browse_add({ count: selected.size })}
					</button>
				</div>
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
