<script lang="ts" module>
	/** One selectable service from the provider's current listing. */
	export type EditorService = {
		id: string;
		name: string;
		hourlyRateCents: number;
		/** The lowest offer — the service's base rate (UAT #39). */
		floorRateCents?: number;
	};
</script>

<script lang="ts">
	/** Terms editor (Flow F): line items added through the full-screen
	 * three-step wizard — pick a service, set rate / expectations, propose
	 * weekly sessions. Hours are derived from sessions, never typed; the old
	 * contract-level free-text schedule is gone. Used for the family draft and
	 * revisions after decline / requested changes. */
	import type { ResolvedPathname } from '$app/types';
	import type { ContractPricing, ContractTerms, ContractTermsInput } from '$lib/api/contracts';
	import PriceBreakdown from '$lib/components/contracts/PriceBreakdown.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import ServiceWizard, {
		type ServiceLineItem
	} from '$lib/components/contracts/ServiceWizard.svelte';
	import {
		formatEndTime,
		formatSessionRange,
		MINUTES_PER_DAY,
		minutesToHours,
		serviceWeeklyCents,
		weeklyMinutes,
		weekdayLabel
	} from '$lib/contract-sessions';
	import { formatDateWithWeekday } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** The provider's current listing — the selectable set and rate floors. */
		providerServices: EditorService[];
		/** Pre-fill (pending draft, or the last version when revising). */
		initial?: ContractTerms | null;
		/** "Maria's listing" for the family. */
		listingLabel: string;
		counterpartFirstName: string;
		/** Chat deep-link for the wizard's missing-service dialog. */
		chatHref?: ResolvedPathname | null;
		/** Tomorrow in the family's zone — the start-date picker's minimum. */
		earliestStartsOn?: string | null;
		/** "Central Time" — shown in the session wizard. */
		timeZoneLabel?: string | null;
		/** No saved family address: no zone, so sending is blocked. */
		locationMissing?: boolean;
		/** Where the family adds their address. */
		profileHref?: ResolvedPathname | null;
		/** No card on file: contract billing charges it, so sending is blocked. */
		paymentMethodMissing?: boolean;
		/** Where the family adds a card. */
		billingHref?: ResolvedPathname | null;
		/** The last saved draft's weekly price with the fee and its tax
		 * (computed by the server). Unsaved edits aren't in it. */
		pricing?: ContractPricing | null;
		/** Prices the editor's current, unsaved terms (B6). When given, the
		 * price box follows every edit instead of the last saved draft. */
		onquote?: (terms: ContractTermsInput) => Promise<ContractPricing | null>;
		busy?: boolean;
		onsave?: (terms: ContractTermsInput) => void;
		onsend: (terms: ContractTermsInput) => void;
	}

	let {
		providerServices,
		initial = null,
		listingLabel,
		counterpartFirstName,
		chatHref = null,
		earliestStartsOn = null,
		timeZoneLabel = null,
		locationMissing = false,
		profileHref = null,
		paymentMethodMissing = false,
		billingHref = null,
		pricing = null,
		onquote,
		busy = false,
		onsave,
		onsend
	}: Props = $props();

	// Deliberate capture-once: `initial` seeds the editor's own mutable state on
	// mount; later prop updates (refetches while editing) must not clobber it.
	// svelte-ignore state_referenced_locally
	let items = $state<ServiceLineItem[]>(
		(initial?.services ?? []).map((service) => ({
			serviceId: service.serviceId,
			name: service.name,
			listedRateCents: service.listedRateCents,
			rateCents: service.rateCents,
			sessions: (service.sessions ?? []).map((session) => ({ ...session })),
			expectations: service.expectations
		}))
	);
	// svelte-ignore state_referenced_locally
	let startsOn = $state(initial?.startsOn ?? '');
	// svelte-ignore state_referenced_locally
	let endsOn = $state(initial?.endsOn ?? '');
	// svelte-ignore state_referenced_locally
	let endsOnOpen = $state(Boolean(initial?.endsOn));
	// svelte-ignore state_referenced_locally
	let endsAtValue = $state(initial?.endsAtMinutes ? String(initial.endsAtMinutes) : '');

	/** The session picker's step. */
	const TIME_STEP_MINUTES = 15;
	/** 12:15 am … midnight, in the session picker's steps. */
	const END_TIME_OPTIONS = Array.from(
		{ length: MINUTES_PER_DAY / TIME_STEP_MINUTES },
		(_, i) => (i + 1) * TIME_STEP_MINUTES
	);

	// An end time only means something on an end date: however the date is
	// emptied (the clear button or the native input), forget the time so it
	// doesn't come back pre-selected with the next date.
	$effect(() => {
		if (!endsOn) endsAtValue = '';
	});

	let wizardOpen = $state(false);
	let editingItem = $state<ServiceLineItem | null>(null);
	let removeCandidate = $state<ServiceLineItem | null>(null);

	const inContract = (id: string) => items.some((item) => item.serviceId === id);

	const weeklyEstimateCents = $derived(
		items.reduce((total, item) => total + serviceWeeklyCents(item.rateCents, item.sessions), 0)
	);
	const estimateBreakdown = $derived(
		items
			.map(
				(item) => `${minutesToHours(weeklyMinutes(item.sessions))} × ${formatMoney(item.rateCents)}`
			)
			.join(' + ')
	);

	function openAdd() {
		editingItem = null;
		wizardOpen = true;
	}

	function openEdit(item: ServiceLineItem) {
		editingItem = item;
		wizardOpen = true;
	}

	function commitWizard(item: ServiceLineItem) {
		items = editingItem
			? items.map((existing) => (existing.serviceId === editingItem?.serviceId ? item : existing))
			: [...items, item];
		wizardOpen = false;
		editingItem = null;
	}

	function removeConfirmed() {
		if (!removeCandidate) return;
		items = items.filter((item) => item.serviceId !== removeCandidate?.serviceId);
		removeCandidate = null;
	}

	function clearEndsOn() {
		endsOn = '';
		endsOnOpen = false;
		endsAtValue = '';
	}

	const toTerms = (): ContractTermsInput => ({
		services: items.map((item) => ({
			serviceId: item.serviceId,
			rateCents: item.rateCents,
			sessions: item.sessions.map((session) => ({ ...session })),
			expectations: item.expectations
		})),
		startsOn: startsOn || null,
		endsOn: endsOn || null,
		endsAtMinutes: endsOn && endsAtValue ? Number(endsAtValue) : null
	});

	// Live price box (B6): re-quoted shortly after each edit; only the newest
	// answer lands. Falls back to the saved draft's price until one arrives.
	let livePricing = $state<ContractPricing | null>(null);
	let quoting = $state(false);
	let quoteRequest = 0;
	$effect(() => {
		const terms = toTerms();
		if (!onquote) return;
		if (terms.services.length === 0) {
			livePricing = null;
			return;
		}
		const id = ++quoteRequest;
		const timer = setTimeout(() => {
			quoting = true;
			void onquote(terms).then((next) => {
				if (id !== quoteRequest) return;
				livePricing = next;
				quoting = false;
			});
		}, 350);
		return () => clearTimeout(timer);
	});
	const shownPricing = $derived(onquote ? (livePricing ?? pricing) : pricing);
</script>

<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{m.contracts_editor_heading({ listing: listingLabel })}
	</h3>

	{#if items.length === 0}
		<p class="rounded-lg bg-base-200 px-4 py-3 text-[13px] text-base-content-muted">
			{m.contracts_editor_empty()}
		</p>
	{/if}

	<ul class="flex flex-col gap-2">
		{#each items as item (item.serviceId)}
			{@const itemMinutes = weeklyMinutes(item.sessions)}
			<li class="flex items-start gap-3 rounded-[10px] border border-card-border px-4 py-3">
				<div class="min-w-0 flex-1">
					<div class="text-[13.5px] font-semibold text-base-content">{item.name}</div>
					<div class="mt-0.5 text-xs text-base-content-muted">
						{m.contracts_per_hour({ amount: formatMoney(item.rateCents) })} · {m.contracts_editor_hours_from_sessions(
							{ hours: minutesToHours(itemMinutes) }
						)}
						=
						<strong class="text-secondary">
							{m.contracts_per_week({
								amount: formatMoney(serviceWeeklyCents(item.rateCents, item.sessions))
							})}
						</strong>
						{#if item.rateCents !== item.listedRateCents}
							<span class="text-outline">
								· {m.contracts_listed_rate({ amount: formatMoney(item.listedRateCents) })}</span
							>
						{/if}
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						{#each item.sessions as session, index (index)}
							<span
								class="inline-flex items-center gap-1.5 rounded-full bg-base-500 px-2.5 py-1
									text-[11px] font-semibold text-info"
							>
								<i class="las la-clock text-[11px]" aria-hidden="true"></i>
								{weekdayLabel(session.weekday)}
								{formatSessionRange(session)}
							</span>
						{/each}
						<span class="text-[11px] font-semibold text-outline">
							{m.contracts_editor_item_proposed({ name: counterpartFirstName })}
						</span>
					</div>
					{#if item.expectations}
						<p class="mt-1.5 text-[12.5px] leading-relaxed text-base-content-muted">
							“{item.expectations}”
						</p>
					{/if}
				</div>
				<div class="flex shrink-0 gap-1.5">
					<button
						type="button"
						class="btn btn-square btn-ghost btn-xs"
						aria-label={m.contracts_editor_edit_service({ name: item.name })}
						onclick={() => openEdit(item)}
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-xs text-error"
						aria-label={m.contracts_editor_remove_service({ name: item.name })}
						onclick={() => (removeCandidate = item)}
					>
						<i class="las la-trash-alt text-base" aria-hidden="true"></i>
					</button>
				</div>
			</li>
		{/each}
	</ul>

	<button
		type="button"
		class="mt-2 text-[13px] font-semibold text-secondary hover:underline"
		disabled={items.length >= 20 || providerServices.every((service) => inContract(service.id))}
		onclick={openAdd}
	>
		{items.length > 0 ? m.contracts_editor_add_another() : m.contracts_editor_add_first()}
	</button>
	<p class="mt-0.5 text-[11px] text-outline">
		{m.contracts_editor_help({ name: counterpartFirstName })}
	</p>

	<div
		class="mt-3 grid grid-cols-[90px_1fr] items-center gap-x-4 gap-y-2 border-t border-base-300 pt-3"
	>
		<label class="text-[13px] text-base-content-muted" for="contract-starts"
			>{m.contracts_terms_starts()}</label
		>
		<input
			id="contract-starts"
			type="date"
			class="input input-sm w-full text-[13px]"
			min={earliestStartsOn ?? undefined}
			bind:value={startsOn}
		/>
		<span class="text-[13px] text-base-content-muted">
			{m.contracts_terms_ends()}
			<span class="text-[11px] text-outline">{m.contracts_optional_paren()}</span>
		</span>
		{#if endsOnOpen}
			<span class="flex items-center gap-1.5">
				<input
					id="contract-ends"
					type="date"
					class="input input-sm w-full text-[13px]"
					min={startsOn || undefined}
					aria-label={m.contracts_editor_end_date_aria()}
					bind:value={endsOn}
				/>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-xs"
					aria-label={m.contracts_editor_clear_end_date()}
					onclick={clearEndsOn}
				>
					<i class="las la-times" aria-hidden="true"></i>
				</button>
			</span>
		{:else}
			<button
				type="button"
				class="rounded-lg border border-dashed border-outline-variant px-3 py-2 text-left
					text-[13px] text-base-content-muted hover:border-primary"
				onclick={() => (endsOnOpen = true)}
			>
				{m.contracts_editor_add_end_date()}
			</button>
		{/if}
		{#if endsOnOpen && endsOn}
			<label class="text-[13px] text-base-content-muted" for="contract-ends-at">
				{m.contracts_editor_last_day()}
				<span class="text-[11px] text-outline">{m.contracts_optional_paren()}</span>
			</label>
			<select
				id="contract-ends-at"
				class="select select-sm w-full text-[13px]"
				bind:value={endsAtValue}
			>
				<option value="">{m.contracts_editor_full_day()}</option>
				{#each END_TIME_OPTIONS as minutes (minutes)}
					<option value={String(minutes)}>
						{m.contracts_until_time({ time: formatEndTime(minutes) })}
					</option>
				{/each}
			</select>
		{/if}
	</div>
	{#if startsOn || endsOn}
		<p class="mt-1 text-right text-[11px] text-outline">
			{#if startsOn}{formatDateWithWeekday(startsOn)}{/if}
			{#if startsOn && endsOn}&nbsp;→&nbsp;{/if}
			{#if endsOn}{endsAtValue
					? m.contracts_date_until({
							date: formatDateWithWeekday(endsOn),
							time: formatEndTime(Number(endsAtValue))
						})
					: formatDateWithWeekday(endsOn)}{/if}
		</p>
	{/if}

	<div class="mt-3 flex items-center justify-between rounded-[10px] bg-secondary px-4 py-3">
		<span class="text-[12.5px] text-secondary-content/80">
			{m.contracts_weekly_estimate()}
			{#if estimateBreakdown}
				<span class="text-secondary-content-faint">({estimateBreakdown})</span>
			{/if}
		</span>
		<span class="font-display text-base font-bold text-secondary-content">
			{formatMoney(weeklyEstimateCents)}
		</span>
	</div>

	<div class="mt-3 border-t border-base-300 pt-3">
		<div class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
			{m.contracts_editor_included_heading()}
		</div>
		<p class="mt-1 text-[12.5px] leading-relaxed text-base-content-muted">
			{m.contracts_editor_included_body()}
		</p>
	</div>

	<div
		class="mt-3 flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3"
	>
		<i class="las la-shield-alt mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
		<p class="text-[12px] leading-relaxed text-neutral">
			{m.contracts_editor_proposals_before()}
			<strong>{m.contracts_editor_proposals_strong()}</strong>{m.contracts_editor_proposals_after({
				name: counterpartFirstName
			})}
		</p>
	</div>

	{#if locationMissing}
		<p class="mt-3 rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
			{m.contracts_editor_location_text()}
			{#if profileHref}
				<a class="font-semibold text-secondary hover:underline" href={profileHref}>
					{m.contracts_editor_location_link()}
				</a>
				{m.contracts_editor_location_after()}
			{/if}
		</p>
	{/if}

	{#if paymentMethodMissing}
		<p class="mt-3 rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
			{#if billingHref}
				<a class="font-semibold text-secondary hover:underline" href={billingHref}
					>{m.contracts_editor_card_link()}</a
				>
			{:else}
				{m.contracts_editor_card_link()}
			{/if}
			{m.contracts_editor_card_after()}
		</p>
	{/if}

	{#if shownPricing}
		<div class="mt-3" aria-busy={quoting}>
			<PriceBreakdown pricing={shownPricing} viewerSide="family" />
			{#if !onquote}
				<p class="mt-1 text-[11px] text-outline">{m.contracts_editor_saved_draft_price()}</p>
			{:else if quoting}
				<p class="mt-1 text-[11px] text-outline">{m.contracts_editor_updating()}</p>
			{/if}
		</div>
	{/if}

	<div class="mt-4 flex items-center gap-2.5">
		<button
			type="button"
			class="btn btn-primary btn-sm"
			disabled={busy || items.length === 0 || locationMissing || paymentMethodMissing}
			onclick={() => onsend(toTerms())}
		>
			{#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
			{m.contracts_editor_sign_send({ name: counterpartFirstName })}
		</button>
		{#if onsave}
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={busy}
				onclick={() => onsave?.(toTerms())}
			>
				{m.contracts_editor_save_draft()}
			</button>
		{/if}
	</div>
</section>

{#if wizardOpen}
	<ServiceWizard
		{providerServices}
		draftItems={items}
		editing={editingItem}
		{listingLabel}
		{counterpartFirstName}
		startsOn={startsOn || null}
		{chatHref}
		{timeZoneLabel}
		oncommit={commitWizard}
		oncancel={() => {
			wizardOpen = false;
			editingItem = null;
		}}
	/>
{/if}

<ConfirmDialog
	open={removeCandidate !== null}
	title={m.contracts_editor_remove_title()}
	body={removeCandidate ? m.contracts_editor_remove_body({ name: removeCandidate.name }) : ''}
	confirmLabel={m.contracts_editor_remove_confirm()}
	onconfirm={removeConfirmed}
	oncancel={() => (removeCandidate = null)}
/>
