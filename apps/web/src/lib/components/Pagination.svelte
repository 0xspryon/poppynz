<script lang="ts" module>
	/** Truncated page list, e.g. [1, '…', 5, 6, 7, '…', 30]. */
	export function pageList(current: number, last: number): Array<number | '…'> {
		if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
		const pages = new Set([1, last, current - 1, current, current + 1]);
		const sorted = [...pages].filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
		const out: Array<number | '…'> = [];
		let previous = 0;
		for (const value of sorted) {
			if (value - previous > 1) out.push('…');
			out.push(value);
			previous = value;
		}
		return out;
	}
</script>

<script lang="ts">
	/** Page-number pagination (design 13b/13c): Prev · 1 … 5 6 7 … 30 · Next,
	 * current page navy, icon-only prev/next. Renders nothing for one page. */
	interface Props {
		page: number;
		totalPages: number;
		/** Called with the page number the user picked. */
		onselect: (page: number) => void;
		label?: string;
	}

	let { page, totalPages, onselect, label = 'Pages' }: Props = $props();
</script>

{#if totalPages > 1}
	<nav class="flex justify-end" aria-label={label}>
		<div class="join">
			<button
				type="button"
				class="btn join-item btn-sm"
				disabled={page <= 1}
				aria-label="Previous page"
				onclick={() => onselect(page - 1)}
			>
				<i class="las la-angle-left" aria-hidden="true"></i>
			</button>
			{#each pageList(page, totalPages) as entry, index (`${entry}-${index}`)}
				{#if entry === '…'}
					<span class="btn btn-disabled join-item btn-sm">…</span>
				{:else}
					<button
						type="button"
						class="btn join-item btn-sm {entry === page ? 'btn-secondary' : ''}"
						aria-current={entry === page ? 'page' : undefined}
						onclick={() => onselect(entry)}
					>
						{entry}
					</button>
				{/if}
			{/each}
			<button
				type="button"
				class="btn join-item btn-sm"
				disabled={page >= totalPages}
				aria-label="Next page"
				onclick={() => onselect(page + 1)}
			>
				<i class="las la-angle-right" aria-hidden="true"></i>
			</button>
		</div>
	</nav>
{/if}
