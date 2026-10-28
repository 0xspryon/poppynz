<script lang="ts">
	/** The session-window explainer (Tier 3, spec §3), wherever sessions are
	 * listed: sessions appear N days ahead, dates further out are handled when
	 * they appear, and cancelling at least the cutoff before a session is free
	 * for the family. Both numbers come from the API. */
	import { sessionWindowParagraphs } from '$lib/session-resolution';

	interface Props {
		windowDays: number;
		cancellationNoticeHours: number;
	}

	let { windowDays, cancellationNoticeHours }: Props = $props();

	const text = $derived(sessionWindowParagraphs({ windowDays, cancellationNoticeHours }).join(' '));
</script>

<p
	class="flex items-start gap-2 rounded-lg bg-info-content px-3.5 py-2.5 text-[12px] leading-relaxed text-info"
	data-testid="session-window-note"
	role="note"
>
	<i class="las la-calendar-alt mt-0.5 shrink-0" aria-hidden="true"></i>
	<span>{text}</span>
</p>
