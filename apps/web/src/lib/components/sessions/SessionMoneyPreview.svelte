<script lang="ts">
	/** What confirming an action (or an answer) would do to the session's
	 * money (Tier 3 step 2, spec §10), stated in the confirmation dialog:
	 * "Maria receives $15.63, you get $50.39 back". Asks the API when the
	 * dialog opens, and again (debounced) as the minutes worked change.
	 * Shows nothing when the API has nothing to say or refuses. */
	import type { SessionAction, SessionResponse } from '$lib/api/contracts';
	import { previewSessionMoney, type SessionMoneyPreview } from '$lib/api/session-money';
	import { previewSentence } from '$lib/session-money';

	interface Props {
		contractId: string;
		sessionId: string;
		/** The action or answer being confirmed. */
		pending:
			| { kind: 'action'; action: SessionAction }
			| { kind: 'response'; response: SessionResponse };
		/** Reduced hours: the minutes worked as typed (blank until entered). */
		minutesWorked?: number | string | null;
		viewerSide: 'family' | 'provider';
		counterpartName: string;
		/** Debounce for the minutes field, in ms. */
		debounceMs?: number;
	}

	let {
		contractId,
		sessionId,
		pending,
		minutesWorked = null,
		viewerSide,
		counterpartName,
		debounceMs = 300
	}: Props = $props();

	let preview = $state<SessionMoneyPreview | null>(null);

	const needsMinutes = $derived(
		pending.kind === 'action' && pending.action === 'report_reduced_hours'
	);
	/** The minutes as a whole number, or null while the field is blank or invalid. */
	const minutes = $derived.by(() => {
		if (minutesWorked === null || String(minutesWorked).trim() === '') return null;
		const value = Number(minutesWorked);
		return Number.isInteger(value) && value >= 0 ? value : null;
	});

	let seq = 0;
	$effect(() => {
		const input =
			pending.kind === 'response'
				? { response: pending.response }
				: { action: pending.action, ...(needsMinutes ? { minutesWorked: minutes } : {}) };
		const ids = { contractId, sessionId };
		seq += 1;
		const mine = seq;
		preview = null;
		// Reduced hours priced without the minutes would be wrong: wait for them.
		if (needsMinutes && minutes === null) return;
		const run = async () => {
			const result = await previewSessionMoney(ids.contractId, ids.sessionId, input);
			if (mine !== seq) return;
			preview = result.ok ? result.data.preview : null;
		};
		if (!needsMinutes) {
			void run();
			return;
		}
		const timer = setTimeout(() => void run(), debounceMs);
		return () => clearTimeout(timer);
	});

	const sentence = $derived(previewSentence(preview, viewerSide, counterpartName));
</script>

{#if sentence}
	<p
		class="mb-3 flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px] font-medium text-base-content"
		role="status"
		data-testid="session-money-preview"
	>
		<i class="las la-coins mt-0.5 shrink-0 text-primary" aria-hidden="true"></i>
		<span>{sentence}</span>
	</p>
{/if}
