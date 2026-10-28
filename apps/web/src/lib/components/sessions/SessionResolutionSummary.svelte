<script lang="ts">
	/** What happened to one session (Tier 3): the label, the status, who
	 * recorded it and when, the reason and note, what a day off counts as,
	 * the other side's answer, the response deadline, and an admin's
	 * decision. */
	import type { SessionResolution } from '$lib/api/contracts';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { formatDateTime } from '$lib/date';
	import { formatNumber } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';
	import {
		resolutionKindLabel,
		resolutionStatusChip,
		sessionReasonLabel
	} from '$lib/session-resolution';

	interface Props {
		resolution: SessionResolution;
		/** The other party's name, from the viewer's side. */
		counterpartName: string;
		/** The session's length, for reduced hours. */
		elapsedMinutes: number;
	}

	let { resolution, counterpartName, elapsedMinutes }: Props = $props();

	const awaitingMe = $derived(resolution.status === 'proposed' && !resolution.reportedByMe);
	const chip = $derived(resolutionStatusChip(resolution.status, awaitingMe));
	const hours = (minutes: number) => formatNumber(minutes / 60, { maximumFractionDigits: 2 });
	const when = $derived(formatDateTime(resolution.recordedAt));
</script>

<div class="flex min-w-[12rem] flex-col gap-0.5 text-[12px]" data-testid="session-resolution">
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="font-semibold text-base-content">{resolutionKindLabel(resolution.kind)}</span>
		<StatusChip status={chip.status} label={chip.label} />
	</div>
	<span class="text-outline">
		{resolution.reportedByMe
			? m.sessions_by_you({ when })
			: m.sessions_by_name({ name: counterpartName, when })}
	</span>
	{#if resolution.reason}
		<span class="text-base-content-muted">
			{m.sessions_reason_line({ reason: sessionReasonLabel(resolution.reason) })}
		</span>
	{/if}
	{#if resolution.minutesWorked !== null}
		<span class="text-base-content-muted">
			{m.sessions_minutes_worked_line({
				worked: hours(resolution.minutesWorked),
				total: hours(elapsedMinutes)
			})}
		</span>
	{/if}
	{#if resolution.note}
		<span class="text-base-content-muted italic">“{resolution.note}”</span>
	{/if}
	{#if resolution.countsAs}
		<span class="text-base-content-muted">
			{m.sessions_counts_as({ kind: resolutionKindLabel(resolution.countsAs) })}
		</span>
	{/if}
	{#if resolution.status === 'proposed' && resolution.respondBy}
		<span class={awaitingMe ? 'font-semibold text-accent' : 'text-outline'}>
			{awaitingMe
				? m.sessions_answer_by({ when: formatDateTime(resolution.respondBy) })
				: m.sessions_waiting_for({
						name: counterpartName,
						when: formatDateTime(resolution.respondBy)
					})}
		</span>
	{/if}
	{#if resolution.response && resolution.respondedAt}
		<span class="text-outline">
			{resolution.respondedByMe
				? m.sessions_answered_by_you({ when: formatDateTime(resolution.respondedAt) })
				: m.sessions_answered_by_name({
						name: counterpartName,
						when: formatDateTime(resolution.respondedAt)
					})}
		</span>
	{/if}
	{#if resolution.responseNote}
		<span class="text-base-content-muted italic">“{resolution.responseNote}”</span>
	{/if}
	{#if resolution.status === 'confirmed' && resolution.response === null && resolution.respondBy}
		<span class="text-outline">{m.sessions_confirmed_by_silence()}</span>
	{/if}
	{#if resolution.decision}
		<span class="font-semibold text-base-content">
			{m.sessions_decided_line({ outcome: resolutionKindLabel(resolution.decision) })}
		</span>
		{#if resolution.decisionReason}
			<span class="text-base-content-muted">{resolution.decisionReason}</span>
		{/if}
	{/if}
</div>
