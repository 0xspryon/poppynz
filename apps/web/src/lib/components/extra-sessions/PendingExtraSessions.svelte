<script lang="ts">
	/** On the contract page (Tier 3 step 3): the other side's extra-session
	 * proposals waiting for the viewer's answer, with a link to each on its
	 * cycle page (where it is confirmed — the family authorising the charge —
	 * or declined). Renders nothing when nothing waits. */
	import type { ResolvedPathname } from '$app/types';
	import { listExtraSessions, type ExtraSession } from '$lib/api/extra-sessions';
	import { formatDateTime } from '$lib/date';
	import { extraSessionLabel } from '$lib/extra-sessions';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	interface Props {
		contractId: string;
		counterpartName: string;
		cycleHref: (cycleId: string) => ResolvedPathname;
	}

	let { contractId, counterpartName, cycleHref }: Props = $props();

	let items = $state<Array<ExtraSession>>([]);

	let seq = 0;
	async function load(id: string) {
		seq += 1;
		const mine = seq;
		const result = await listExtraSessions(id);
		if (mine !== seq || id !== contractId) return;
		items = result.ok
			? result.data.extraSessions.filter(
					(row) => row.actions.includes('accept') && row.cycleId !== null
				)
			: [];
	}

	$effect(() => {
		void load(contractId);
	});

	onMount(() =>
		notifications.on('contract.extra_session', (event) => {
			if (event.payload.contractId === contractId) void load(contractId);
		})
	);
</script>

{#if items.length > 0}
	<section
		class="rounded-xl border border-accent/40 bg-base-100 px-5 py-4"
		data-testid="pending-extra-sessions"
	>
		<h3 class="mb-2 flex items-center gap-2 font-display text-[13.5px] font-bold text-base-content">
			{m.extra_sessions_pending_heading()}
			<span class="badge badge-sm badge-accent">{items.length}</span>
		</h3>
		<ul class="divide-y divide-base-300">
			{#each items as item (item.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
					<span class="min-w-0 flex-1">
						<span class="font-medium text-base-content">
							{m.extra_sessions_pending_item({ name: counterpartName })}
						</span>
						<span class="block text-[11.5px] text-outline">
							{extraSessionLabel(item)} · {m.sessions_answer_by({
								when: formatDateTime(item.respondBy)
							})}
						</span>
					</span>
					<a class="btn btn-xs btn-primary" href={cycleHref(item.cycleId!)}>
						{m.extra_sessions_pending_review()}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
