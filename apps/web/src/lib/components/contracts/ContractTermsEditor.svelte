<script lang="ts" module>
	/** One selectable service from the provider's current listing. */
	export type EditorService = { id: string; name: string; hourlyRateCents: number };
</script>

<script lang="ts">
	/** Terms editor (Flow F): line items added through the full-screen
	 * three-step wizard — pick a service, set rate / expectations, propose
	 * weekly sessions. Hours are derived from sessions, never typed; the old
	 * contract-level free-text schedule is gone. Used for the family draft and
	 * revisions after decline / requested changes. */
	import type { ResolvedPathname } from '$app/types';
	import type { ContractTerms, ContractTermsInput } from '$lib/api/contracts';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import ServiceWizard, {
		type ServiceLineItem
	} from '$lib/components/contracts/ServiceWizard.svelte';
	import {
		formatSessionRange,
		minutesToHours,
		serviceWeeklyCents,
		weeklyMinutes,
		WEEKDAY_LABELS
	} from '$lib/contract-sessions';
	import { formatDateWithWeekday } from '$lib/date';
	import { centsToDollars } from '$lib/money';

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
				(item) =>
					`${minutesToHours(weeklyMinutes(item.sessions))} × $${centsToDollars(item.rateCents)}`
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
	}

	const toTerms = (): ContractTermsInput => ({
		services: items.map((item) => ({
			serviceId: item.serviceId,
			rateCents: item.rateCents,
			sessions: item.sessions.map((session) => ({ ...session })),
			expectations: item.expectations
		})),
		startsOn: startsOn || null,
		endsOn: endsOn || null
	});
</script>

<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		Services &amp; sessions — from {listingLabel}
	</h3>

	{#if items.length === 0}
		<p class="rounded-lg bg-base-200 px-4 py-3 text-[13px] text-base-content-muted">
			No services yet — add the first one to build the terms.
		</p>
	{/if}

	<ul class="flex flex-col gap-2">
		{#each items as item (item.serviceId)}
			{@const itemMinutes = weeklyMinutes(item.sessions)}
			<li class="flex items-start gap-3 rounded-[10px] border border-card-border px-4 py-3">
				<div class="min-w-0 flex-1">
					<div class="text-[13.5px] font-semibold text-base-content">{item.name}</div>
					<div class="mt-0.5 text-xs text-base-content-muted">
						${centsToDollars(item.rateCents)}/hr · {minutesToHours(itemMinutes)} hrs/wk from sessions
						=
						<strong class="text-secondary">
							${centsToDollars(serviceWeeklyCents(item.rateCents, item.sessions))}/wk
						</strong>
						{#if item.rateCents !== item.listedRateCents}
							<span class="text-outline"> · listed ${centsToDollars(item.listedRateCents)}</span>
						{/if}
					</div>
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						{#each item.sessions as session, index (index)}
							<span
								class="inline-flex items-center gap-1.5 rounded-full bg-base-500 px-2.5 py-1
									text-[11px] font-semibold text-info"
							>
								<i class="las la-clock text-[11px]" aria-hidden="true"></i>
								{WEEKDAY_LABELS[session.weekday]}
								{formatSessionRange(session)}
							</span>
						{/each}
						<span class="text-[11px] font-semibold text-outline">
							proposed · {counterpartFirstName} reviews
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
						aria-label="Edit {item.name}"
						onclick={() => openEdit(item)}
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="btn btn-square btn-ghost btn-xs text-error"
						aria-label="Remove {item.name}"
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
		+ Add {items.length > 0 ? 'another' : 'a'} service
	</button>
	<p class="mt-0.5 text-[11px] text-outline">
		Each service is set up in its own 3-step dialog — Edit reopens it pre-filled. You set session
		times yourself; {counterpartFirstName} confirms they work when reviewing.
	</p>

	<div
		class="mt-3 grid grid-cols-[90px_1fr] items-center gap-x-4 gap-y-2 border-t border-base-300 pt-3"
	>
		<label class="text-[13px] text-base-content-muted" for="contract-starts">Starts</label>
		<input
			id="contract-starts"
			type="date"
			class="input input-sm w-full text-[13px]"
			bind:value={startsOn}
		/>
		<span class="text-[13px] text-base-content-muted">
			Ends <span class="text-[11px] text-outline">(optional)</span>
		</span>
		{#if endsOnOpen}
			<span class="flex items-center gap-1.5">
				<input
					id="contract-ends"
					type="date"
					class="input input-sm w-full text-[13px]"
					min={startsOn || undefined}
					aria-label="End date"
					bind:value={endsOn}
				/>
				<button
					type="button"
					class="btn btn-circle btn-ghost btn-xs"
					aria-label="Remove the end date — make the contract ongoing"
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
				Ongoing · + add an end date
			</button>
		{/if}
	</div>
	{#if startsOn || endsOn}
		<p class="mt-1 text-right text-[11px] text-outline">
			{#if startsOn}{formatDateWithWeekday(startsOn)}{/if}
			{#if startsOn && endsOn}&nbsp;→&nbsp;{/if}
			{#if endsOn}{formatDateWithWeekday(endsOn)}{/if}
		</p>
	{/if}

	<div class="mt-3 flex items-center justify-between rounded-[10px] bg-secondary px-4 py-3">
		<span class="text-[12.5px] text-secondary-content/80">
			Weekly estimate
			{#if estimateBreakdown}
				<span class="text-secondary-content-faint">({estimateBreakdown})</span>
			{/if}
		</span>
		<span class="font-display text-base font-bold text-secondary-content">
			${centsToDollars(weeklyEstimateCents)}
		</span>
	</div>

	<div class="mt-3 border-t border-base-300 pt-3">
		<div class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
			Included automatically
		</div>
		<p class="mt-1 text-[12.5px] leading-relaxed text-base-content-muted">
			Payments on Poppynz · contact details shared once active · either side can end with 2 weeks'
			notice.
		</p>
	</div>

	<div
		class="mt-3 flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3"
	>
		<i class="las la-shield-alt mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
		<p class="text-[12px] leading-relaxed text-neutral">
			All sessions are <strong>proposals</strong>. {counterpartFirstName} reviews the contract as a whole
			— they accept &amp; sign, or request changes in chat. Nothing is booked automatically.
		</p>
	</div>

	<div class="mt-4 flex items-center gap-2.5">
		<button
			type="button"
			class="btn btn-primary btn-sm"
			disabled={busy || items.length === 0}
			onclick={() => onsend(toTerms())}
		>
			{#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
			Send to {counterpartFirstName}
		</button>
		{#if onsave}
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={busy}
				onclick={() => onsave?.(toTerms())}
			>
				Save draft
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
		oncommit={commitWizard}
		oncancel={() => {
			wizardOpen = false;
			editingItem = null;
		}}
	/>
{/if}

<ConfirmDialog
	open={removeCandidate !== null}
	title="Remove this service?"
	body={removeCandidate
		? `“${removeCandidate.name}” comes off the terms — its rate, sessions and expectations are discarded.`
		: ''}
	confirmLabel="Remove service"
	onconfirm={removeConfirmed}
	oncancel={() => (removeCandidate = null)}
/>
