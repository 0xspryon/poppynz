<script lang="ts">
	/** Propose an extra session (Tier 3 step 3): a date in the open range, a
	 * start and end time in the contract zone and one of the contract's
	 * services. The price is asked from the API as the fields change (the
	 * family sees what it pays, the helper what it receives); the family must
	 * tick "I authorise Poppynz to charge my card $X" for exactly that amount.
	 * Refusals and the outcome are toasts. */
	import {
		proposeExtraSession,
		quoteExtraSession,
		type ExtraSessionPolicy,
		type ExtraSessionProposeFacts,
		type ExtraSessionQuote
	} from '$lib/api/extra-sessions';
	import { formatDateWithWeekday } from '$lib/date';
	import { delayText, extraSessionErrorMessage, timeToMinutes } from '$lib/extra-sessions';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { untrack } from 'svelte';

	interface Props {
		open: boolean;
		contractId: string;
		facts: ExtraSessionProposeFacts;
		policy: ExtraSessionPolicy;
		counterpartName: string;
		/** A date to start from (e.g. the cycle's first open day). */
		initialDate?: string | null;
		onclose: () => void;
		onproposed?: () => void;
		/** Debounce for the live price, in ms. */
		debounceMs?: number;
	}

	let {
		open,
		contractId,
		facts,
		policy,
		counterpartName,
		initialDate = null,
		onclose,
		onproposed,
		debounceMs = 300
	}: Props = $props();

	const isFamily = $derived(facts.viewerSide === 'family');

	let date = $state('');
	let start = $state('');
	let end = $state('');
	let serviceId = $state('');
	let note = $state('');
	let authorised = $state(false);
	let busy = $state(false);
	let quote = $state<ExtraSessionQuote | null>(null);
	let quoting = $state(false);
	let quoteError = $state<string | null>(null);

	// Reset whenever the dialog opens (not when the facts refresh under it).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			date = initialDate ?? facts.lastDate ?? '';
			start = '';
			end = '';
			serviceId = facts.services[0]?.serviceId ?? '';
			note = '';
			authorised = false;
			quote = null;
			quoteError = null;
		});
	});

	const slot = $derived.by(() => {
		const startMinutes = timeToMinutes(start);
		const endMinutes = timeToMinutes(end, true);
		if (!date || !serviceId || startMinutes === null || endMinutes === null) return null;
		return { date, startMinutes, endMinutes, serviceId };
	});

	let seq = 0;
	$effect(() => {
		const current = slot;
		seq += 1;
		const mine = seq;
		quote = null;
		quoteError = null;
		authorised = false;
		if (!open || current === null) {
			quoting = false;
			return;
		}
		quoting = true;
		const timer = setTimeout(async () => {
			const result = await quoteExtraSession(contractId, current);
			if (mine !== seq) return;
			quoting = false;
			if (result.ok) quote = result.data.quote;
			else quoteError = extraSessionErrorMessage(result.error, { minMinutes: policy.minMinutes });
		}, debounceMs);
		return () => clearTimeout(timer);
	});

	const canSubmit = $derived(slot !== null && quote !== null && !busy && (!isFamily || authorised));

	async function submit() {
		if (!canSubmit || slot === null || quote === null) return;
		busy = true;
		const result = await proposeExtraSession(contractId, {
			...slot,
			note: note.trim() || null,
			authorisedCents: isFamily ? quote.authoriseCents : null
		});
		busy = false;
		if (!result.ok) {
			toast.error(extraSessionErrorMessage(result.error, { minMinutes: policy.minMinutes }));
			return;
		}
		toast.success(m.extra_sessions_toast_proposed({ name: counterpartName }));
		onproposed?.();
		onclose();
	}
</script>

{#if open}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.extra_sessions_propose_title()}
		tabindex="-1"
		onkeydown={(event) => {
			if (event.key === 'Escape' && !busy) onclose();
		}}
		data-testid="propose-extra-session"
	>
		<div
			class="modal-box max-w-md border border-card-border"
			tabindex="-1"
			{@attach (box) => box.focus()}
		>
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.extra_sessions_propose_title()}
			</h3>
			<p class="py-3 text-sm text-base-content-muted">
				{m.extra_sessions_propose_body({
					first: facts.firstDate ? formatDateWithWeekday(facts.firstDate) : '',
					last: facts.lastDate ? formatDateWithWeekday(facts.lastDate) : '',
					zone: facts.timeZoneLabel,
					name: counterpartName,
					hours: policy.responseHours
				})}
			</p>
			<div class="flex flex-col gap-3 text-[12.5px]">
				<label class="flex flex-col gap-1">
					<span class="font-semibold text-base-content">{m.extra_sessions_field_date()}</span>
					<input
						type="date"
						class="input input-sm w-full"
						min={facts.firstDate ?? undefined}
						max={facts.lastDate ?? undefined}
						bind:value={date}
						data-testid="extra-session-date"
					/>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="flex flex-col gap-1">
						<span class="font-semibold text-base-content">{m.extra_sessions_field_start()}</span>
						<input
							type="time"
							step="300"
							class="input input-sm w-full"
							bind:value={start}
							data-testid="extra-session-start"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="font-semibold text-base-content">{m.extra_sessions_field_end()}</span>
						<input
							type="time"
							step="300"
							class="input input-sm w-full"
							bind:value={end}
							data-testid="extra-session-end"
						/>
					</label>
				</div>
				<label class="flex flex-col gap-1">
					<span class="font-semibold text-base-content">{m.extra_sessions_field_service()}</span>
					<select
						class="select select-sm w-full"
						bind:value={serviceId}
						data-testid="extra-session-service"
					>
						{#each facts.services as service (service.serviceId)}
							<option value={service.serviceId}>
								{service.name} · {formatMoney(service.rateCents)}/h
							</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1">
					<span class="font-semibold text-base-content">
						{m.extra_sessions_field_note({ name: counterpartName })}
					</span>
					<textarea
						class="textarea textarea-sm w-full"
						rows="2"
						maxlength="1000"
						bind:value={note}
						data-testid="extra-session-note"
					></textarea>
				</label>

				<div
					class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
					role="status"
					data-testid="extra-session-quote"
				>
					{#if quoting}
						<span class="text-base-content-muted">{m.extra_sessions_quote_loading()}</span>
					{:else if quoteError}
						<span class="text-error">{quoteError}</span>
					{:else if quote}
						<p class="font-medium text-base-content">
							{isFamily
								? m.extra_sessions_quote_family({
										amount: formatMoney(quote.familyTotalCents ?? quote.authoriseCents)
									})
								: m.extra_sessions_quote_helper({
										amount: formatMoney(quote.helperShareCents ?? 0)
									})}
						</p>
						<p class="mt-1 text-[11.5px] text-base-content-muted">
							{isFamily
								? m.extra_sessions_propose_delay_family({
										name: counterpartName,
										delay: delayText(policy.chargeDelayMinutes)
									})
								: m.extra_sessions_propose_delay_helper({
										delay: delayText(policy.chargeDelayMinutes)
									})}
						</p>
					{/if}
				</div>

				{#if isFamily && quote}
					<label class="flex items-start gap-2" data-testid="extra-session-authorise">
						<input
							type="checkbox"
							class="checkbox mt-0.5 checkbox-sm checkbox-primary"
							bind:checked={authorised}
						/>
						<span>
							<span class="font-semibold text-base-content">
								{m.extra_sessions_authorise({ amount: formatMoney(quote.authoriseCents) })}
							</span>
							<span class="block text-[11.5px] text-base-content-muted">
								{m.extra_sessions_authorise_hint()}
							</span>
						</span>
					</label>
				{/if}
			</div>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={onclose} disabled={busy}>
					{m.common_back()}
				</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={() => void submit()}
					disabled={!canSubmit}
					data-testid="extra-session-submit"
				>
					{#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
					{m.extra_sessions_propose_submit()}
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label={m.common_close()}
		></button>
	</div>
{/if}
