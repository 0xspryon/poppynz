<script lang="ts">
	/** On the family's contract page (Tier 3 step 1b): the upcoming sessions
	 * the helper cancelled, each with the replacement already started for it
	 * or a "Find a replacement" for the ones still uncovered (one search per
	 * service). Renders nothing when there are none. */
	import { resolve } from '$app/paths';
	import { getReplacementContext, type ReplacementContext } from '$lib/api/contracts';
	import { notifications } from '$lib/notifications.svelte';
	import { formatDate } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { findReplacementHref, replacementSessionLabel } from '$lib/replacement';
	import { onMount } from 'svelte';

	interface Props {
		contractId: string;
	}

	let { contractId }: Props = $props();

	let context = $state<ReplacementContext | null>(null);

	let seq = 0;
	async function load(id: string) {
		seq += 1;
		const mine = seq;
		const result = await getReplacementContext(id);
		if (mine !== seq || id !== contractId) return;
		context = result.ok ? result.data.replacement : null;
	}

	$effect(() => {
		void load(contractId);
	});

	onMount(() =>
		notifications.on('contract.session', (event) => {
			if (event.payload.contractId === contractId) void load(contractId);
		})
	);

	/** One Find help search per stretch the API groups the uncovered
	 * sessions into (one service each, and dates one short contract can book
	 * exactly — never sessions the helper still works in between). */
	const searches = $derived(context?.stretches ?? []);
	const manyServices = $derived(new Set(searches.map((search) => search.serviceName)).size > 1);

	function searchLabel(search: { serviceName: string; sessionIds: Array<string> }) {
		const parts: Array<string> = [m.replacement_find_action()];
		if (manyServices) parts.push(search.serviceName);
		if (searches.length > 1) {
			const dates = (context?.sessions ?? [])
				.filter((session) => search.sessionIds.includes(session.id))
				.map((session) => session.date);
			const first = dates[0];
			const last = dates[dates.length - 1];
			if (first && last) {
				parts.push(
					first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`
				);
			}
		}
		return parts.join(' · ');
	}
</script>

{#if context && context.sessions.length > 0}
	<section
		class="rounded-xl border border-accent/40 bg-base-100 px-5 py-4"
		data-testid="replaceable-sessions"
	>
		<h3 class="font-display text-[13.5px] font-bold text-base-content">
			{m.replacement_contract_heading({ name: context.helper.name })}
		</h3>
		<p class="mt-0.5 text-[12px] leading-relaxed text-base-content-muted">
			{m.replacement_contract_body()}
		</p>
		<ul class="mt-2 divide-y divide-base-300">
			{#each context.sessions as session (session.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
					<span class="min-w-0 flex-1">
						<span class="font-medium text-base-content">{session.serviceName}</span>
						<span class="block text-[11.5px] text-outline">{replacementSessionLabel(session)}</span>
					</span>
					{#if session.replacementContractId}
						<a
							class="btn btn-ghost btn-xs text-secondary"
							href={resolve('/family/contracts/[id]', { id: session.replacementContractId })}
						>
							{m.replacement_contract_started()}
							<i class="las la-angle-right" aria-hidden="true"></i>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
		{#if searches.length > 0}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each searches as search (search.sessionIds.join(','))}
					<a
						class="btn btn-sm btn-secondary"
						href={findReplacementHref(search.serviceName, {
							contractId,
							sessionIds: search.sessionIds
						})}
						data-testid="contract-find-replacement"
					>
						<i class="las la-search" aria-hidden="true"></i>
						{searchLabel(search)}
					</a>
				{/each}
			</div>
		{/if}
	</section>
{/if}
