<script lang="ts">
	/** "All services" browser (provider services page): search + category
	 * filters over the live catalogue, multi-select, add in one go. Owns the
	 * query/filter/selection; emits the selected catalogue ids. */
	import { SvelteSet } from 'svelte/reactivity';
	import type { CatalogueItem } from '$lib/api/service-catalogue';
	import { centsToDollars } from '$lib/money';

	interface Props {
		open: boolean;
		catalogue: Array<CatalogueItem>;
		/** Catalogue ids the provider already offers — shown checked and disabled. */
		linkedIds: Set<string>;
		busy?: boolean;
		onadd: (ids: Array<string>) => void;
		oncancel: () => void;
	}

	let { open, catalogue, linkedIds, busy = false, onadd, oncancel }: Props = $props();

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

	function toggle(item: CatalogueItem) {
		if (linkedIds.has(item.id)) return;
		if (selected.has(item.id)) {
			selected.delete(item.id);
		} else {
			selected.add(item.id);
		}
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label="All services">
		<div class="modal-box max-w-2xl p-0">
			<div class="px-6 pt-5">
				<div class="flex items-center justify-between">
					<h2 class="text-lg font-bold">All services</h2>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-sm"
						aria-label="Close"
						onclick={oncancel}
					>
						<i class="las la-times text-lg" aria-hidden="true"></i>
					</button>
				</div>
				<p class="mt-0.5 mb-3.5 text-[13px] text-base-content-muted">
					Select any service to add it — its base rate is the floor for your rate.
				</p>
				<label class="input mb-3 w-full">
					<i class="las la-search text-base text-outline" aria-hidden="true"></i>
					<input type="search" placeholder="Search services…" bind:value={query} />
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
						All · {catalogue.length}
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
					<button
						type="button"
						class="flex w-full items-center gap-3 border-b border-base-300 px-5 py-3 text-left
							{isSelected ? 'bg-base-200' : ''}"
						onclick={() => toggle(item)}
						disabled={inList}
					>
						<span
							class="flex size-5 shrink-0 items-center justify-center rounded-full
								{inList
								? 'bg-success'
								: isSelected
									? 'bg-primary'
									: 'border-[1.5px] border-outline-variant'}"
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
								<span class="ml-2 text-[11px] text-success">already in your list</span>
							{/if}
						</span>
						<span class="shrink-0 font-display text-[13.5px] font-bold text-secondary">
							${centsToDollars(item.baseHourlyRateCents)}<span
								class="text-[10.5px] font-normal text-outline">/hr</span
							>
						</span>
					</button>
				{:else}
					<p class="px-5 py-6 text-sm text-base-content-muted">No services match your search.</p>
				{/each}
			</div>
			<div class="flex items-center justify-between bg-base-200 px-6 py-4">
				<span class="text-[13px] text-base-content-muted">{selected.size} selected</span>
				<div class="flex gap-2.5">
					<button type="button" class="btn btn-ghost" onclick={oncancel}>Cancel</button>
					<button
						type="button"
						class="btn btn-primary"
						disabled={selected.size === 0 || busy}
						onclick={() => onadd([...selected])}
					>
						{#if busy}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Add {selected.size}
						{selected.size === 1 ? 'service' : 'services'}
					</button>
				</div>
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
