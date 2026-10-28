<script lang="ts">
	/** On the contract page (Tier 3): what waits for the viewer's answer —
	 * the other side's reports and day-off proposals — with a count badge and
	 * a link to each session on its cycle page. Renders nothing when nothing
	 * waits. */
	import type { ResolvedPathname } from '$app/types';
	import { listPendingSessionResponses, type PendingSessionResponse } from '$lib/api/contracts';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
	import { resolutionKindLabel } from '$lib/session-resolution';
	import { onMount } from 'svelte';

	interface Props {
		contractId: string;
		counterpartName: string;
		cycleHref: (cycleId: string) => ResolvedPathname;
	}

	let { contractId, counterpartName, cycleHref }: Props = $props();

	let items = $state<Array<PendingSessionResponse>>([]);

	let seq = 0;
	async function load(id: string) {
		seq += 1;
		const mine = seq;
		const result = await listPendingSessionResponses(id);
		if (mine !== seq || id !== contractId) return;
		items = result.ok ? result.data.items : [];
	}

	$effect(() => {
		void load(contractId);
	});

	onMount(() =>
		notifications.on('contract.session', (event) => {
			if (event.payload.contractId === contractId) void load(contractId);
		})
	);
</script>

{#if items.length > 0}
	<section
		class="rounded-xl border border-accent/40 bg-base-100 px-5 py-4"
		data-testid="pending-session-responses"
	>
		<h3 class="mb-2 flex items-center gap-2 font-display text-[13.5px] font-bold text-base-content">
			{m.sessions_pending_heading()}
			<span class="badge badge-sm badge-accent" data-testid="pending-session-badge">
				{items.length}
			</span>
		</h3>
		<ul class="divide-y divide-base-300">
			{#each items as item (item.resolution.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
					<span class="min-w-0 flex-1">
						<span class="font-medium text-base-content">
							{m.sessions_pending_item({
								name: counterpartName,
								kind: resolutionKindLabel(item.resolution.kind)
							})}
						</span>
						<span class="block text-[11.5px] text-outline">
							{item.session.serviceName} · {formatDateWithWeekday(item.session.date)} · {formatSessionRange(
								{
									weekday: 0,
									startMinutes: item.session.startMinutes,
									endMinutes: item.session.endMinutes
								}
							)}
							{#if item.resolution.respondBy}
								· {m.sessions_answer_by({ when: formatDateTime(item.resolution.respondBy) })}
							{/if}
						</span>
					</span>
					<a class="btn btn-xs btn-primary" href={cycleHref(item.cycleId)}>
						{m.sessions_pending_review()}
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
