<script lang="ts" module>
	/** One selectable service from the provider's current listing. */
	export type EditorService = { id: string; name: string; hourlyRateCents: number };
</script>

<script lang="ts">
	/** Terms editor (design 16d): line items added through a two-step wizard —
	 * pick one of the provider's services, then set rate / weekly hours /
	 * expectations. Rates floor at the listed rate ("you can offer more, never
	 * less"). Used for the family draft, revisions after decline / requested
	 * changes, and amendments from either side. */
	import type { ContractTerms, ContractTermsInput } from '$lib/api/contracts';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { formatDateWithWeekday } from '$lib/date';
	import { centsToDollars, dollarsToCents } from '$lib/money';

	type LineItem = {
		serviceId: string;
		name: string;
		listedRateCents: number;
		rateCents: number;
		hoursPerWeek: number;
		expectations: string;
	};

	interface Props {
		/** The provider's current listing — the selectable set and rate floors. */
		providerServices: EditorService[];
		/** Pre-fill (pending draft, or the last version when revising). */
		initial?: ContractTerms | null;
		mode: 'draft' | 'amendment';
		/** "Maria's listing" for the family, "your listing" for a provider
		 * amending their own contract. */
		listingLabel: string;
		counterpartFirstName: string;
		busy?: boolean;
		onsave?: (terms: ContractTermsInput) => void;
		onsend: (terms: ContractTermsInput) => void;
		oncancel?: () => void;
	}

	let {
		providerServices,
		initial = null,
		mode,
		listingLabel,
		counterpartFirstName,
		busy = false,
		onsave,
		onsend,
		oncancel
	}: Props = $props();

	// Deliberate capture-once: `initial` seeds the editor's own mutable state on
	// mount; later prop updates (refetches while editing) must not clobber it.
	// svelte-ignore state_referenced_locally
	let items = $state<LineItem[]>(
		(initial?.services ?? []).map((service) => ({
			serviceId: service.serviceId,
			name: service.name,
			listedRateCents: service.listedRateCents,
			rateCents: service.rateCents,
			hoursPerWeek: service.hoursPerWeek,
			expectations: service.expectations
		}))
	);
	// svelte-ignore state_referenced_locally
	let schedule = $state(initial?.schedule ?? '');
	// svelte-ignore state_referenced_locally
	let startsOn = $state(initial?.startsOn ?? '');

	// Add-service wizard (16d): step 1 picks a service, step 2 configures it.
	// Editing an existing line item reopens step 2 pre-filled.
	let wizardOpen = $state(false);
	let wizardStep = $state<1 | 2>(1);
	let pickedServiceId = $state<string | null>(null);
	let editingServiceId = $state<string | null>(null);
	let rateInput = $state('');
	let hours = $state(2);
	let expectations = $state('');
	let rateError = $state<string | null>(null);
	let removeCandidate = $state<LineItem | null>(null);

	const serviceById = (id: string | null) =>
		providerServices.find((service) => service.id === id) ?? null;
	const inContract = (id: string) => items.some((item) => item.serviceId === id);
	// Editing falls back to the line item's own snapshot when the service was
	// delisted (or the listing hasn't loaded) — Edit must never be a silent
	// no-op; the snapshot's listed rate keeps the floor meaningful.
	const pickedService = $derived.by(() => {
		const listed = serviceById(pickedServiceId);
		if (listed) return listed;
		const item = items.find((existing) => existing.serviceId === pickedServiceId);
		return item
			? { id: item.serviceId, name: item.name, hourlyRateCents: item.listedRateCents }
			: null;
	});

	const weeklyEstimateCents = $derived(
		Math.round(items.reduce((total, item) => total + item.rateCents * item.hoursPerWeek, 0))
	);
	const wizardRateCents = $derived(dollarsToCents(rateInput));
	const wizardLineCents = $derived(
		wizardRateCents !== null ? Math.round(wizardRateCents * hours) : null
	);

	function openAdd() {
		editingServiceId = null;
		pickedServiceId = providerServices.find((service) => !inContract(service.id))?.id ?? null;
		wizardStep = 1;
		rateError = null;
		wizardOpen = true;
	}

	function openEdit(item: LineItem) {
		editingServiceId = item.serviceId;
		pickedServiceId = item.serviceId;
		rateInput = centsToDollars(item.rateCents);
		hours = item.hoursPerWeek;
		expectations = item.expectations;
		rateError = null;
		wizardStep = 2;
		wizardOpen = true;
	}

	function toStepTwo() {
		const service = pickedService;
		if (!service) return;
		rateInput = centsToDollars(service.hourlyRateCents);
		hours = 2;
		expectations = '';
		rateError = null;
		wizardStep = 2;
	}

	function commitWizard() {
		const service = pickedService;
		if (!service) {
			rateError = 'This service is no longer available.';
			return;
		}
		const rateCents = wizardRateCents;
		if (rateCents === null) {
			rateError = 'Enter a valid hourly rate.';
			return;
		}
		if (rateCents < service.hourlyRateCents) {
			rateError = `Starts at the listed rate — $${centsToDollars(service.hourlyRateCents)}/hr or more.`;
			return;
		}
		// Mirrors the API's upper bound so the failure is inline, not a toast.
		if (rateCents > 1_000_000) {
			rateError = 'That rate looks too high — $10,000/hr is the maximum.';
			return;
		}
		const item: LineItem = {
			serviceId: service.id,
			name: service.name,
			listedRateCents: service.hourlyRateCents,
			rateCents,
			hoursPerWeek: hours,
			expectations: expectations.trim()
		};
		items = editingServiceId
			? items.map((existing) => (existing.serviceId === editingServiceId ? item : existing))
			: [...items, item];
		wizardOpen = false;
	}

	function removeConfirmed() {
		if (!removeCandidate) return;
		items = items.filter((item) => item.serviceId !== removeCandidate?.serviceId);
		removeCandidate = null;
	}

	const toTerms = (): ContractTermsInput => ({
		services: items.map((item) => ({
			serviceId: item.serviceId,
			rateCents: item.rateCents,
			hoursPerWeek: item.hoursPerWeek,
			expectations: item.expectations
		})),
		schedule: schedule.trim() || null,
		startsOn: startsOn || null
	});
</script>

<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		Services &amp; rates — from {listingLabel}
	</h3>

	{#if items.length === 0}
		<p class="rounded-lg bg-base-200 px-4 py-3 text-[13px] text-base-content-muted">
			No services yet — add the first one to build the terms.
		</p>
	{/if}

	<ul class="flex flex-col gap-2">
		{#each items as item (item.serviceId)}
			<li class="flex items-start gap-3 rounded-[10px] border border-card-border px-4 py-3">
				<div class="min-w-0 flex-1">
					<div class="text-[13.5px] font-semibold text-base-content">{item.name}</div>
					<div class="mt-0.5 text-xs text-base-content-muted">
						{item.hoursPerWeek} hrs/wk × ${centsToDollars(item.rateCents)}/hr =
						<strong class="text-secondary">
							${centsToDollars(Math.round(item.rateCents * item.hoursPerWeek))}/wk
						</strong>
						{#if item.rateCents > item.listedRateCents}
							<span class="text-outline"> · listed ${centsToDollars(item.listedRateCents)}</span>
						{/if}
					</div>
					{#if item.expectations}
						<p class="mt-1 text-[12.5px] leading-relaxed text-base-content-muted">
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
		Each service is set up in its own dialog — Edit reopens it pre-filled.
	</p>

	<div class="mt-3 grid grid-cols-[90px_1fr] items-center gap-x-4 gap-y-2 border-t border-base-300 pt-3">
		<label class="text-[13px] text-base-content-muted" for="contract-schedule">Schedule</label>
		<input
			id="contract-schedule"
			type="text"
			class="input input-sm w-full text-[13px]"
			placeholder="e.g. Tue & Thu 3:30–6:00 pm"
			maxlength={2000}
			bind:value={schedule}
		/>
		<label class="text-[13px] text-base-content-muted" for="contract-starts">Starts</label>
		<input
			id="contract-starts"
			type="date"
			class="input input-sm w-full text-[13px]"
			bind:value={startsOn}
		/>
	</div>
	{#if startsOn}
		<p class="mt-1 text-right text-[11px] text-outline">{formatDateWithWeekday(startsOn)}</p>
	{/if}

	<div class="mt-3 flex items-center justify-between rounded-[10px] bg-secondary px-4 py-3">
		<span class="text-[12.5px] text-secondary-content/80">Weekly estimate</span>
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

	<div class="mt-4 flex items-center gap-2.5">
		<button
			type="button"
			class="btn btn-primary btn-sm"
			disabled={busy || items.length === 0}
			onclick={() => onsend(toTerms())}
		>
			{#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
			{mode === 'amendment' ? 'Send amendment' : `Send to ${counterpartFirstName}`}
		</button>
		{#if mode === 'draft' && onsave}
			<button
				type="button"
				class="btn btn-outline btn-sm"
				disabled={busy}
				onclick={() => onsave?.(toTerms())}
			>
				Save draft
			</button>
		{/if}
		{#if oncancel}
			<button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={oncancel}>
				Cancel
			</button>
		{/if}
	</div>
</section>

{#if wizardOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Add a service">
		<div class="modal-box max-w-md border border-card-border p-0">
			<div class="flex items-center gap-2.5 border-b border-base-300 px-6 py-4">
				{#if wizardStep === 2 && !editingServiceId}
					<button
						type="button"
						class="btn btn-circle btn-ghost btn-sm"
						aria-label="Back to service list"
						onclick={() => (wizardStep = 1)}
					>
						<i class="las la-angle-left text-lg" aria-hidden="true"></i>
					</button>
				{/if}
				<div class="min-w-0">
					<h2 class="truncate font-display text-base font-bold text-base-content">
						{wizardStep === 1 ? 'Add a service' : (pickedService?.name ?? 'Configure service')}
					</h2>
					<p class="text-[11px] text-outline">
						{#if wizardStep === 1}
							From {listingLabel} · Step 1 of 2
						{:else if pickedService}
							Listed rate ${centsToDollars(pickedService.hourlyRateCents)}/hr · Step 2 of 2
						{/if}
					</p>
				</div>
				<button
					type="button"
					class="btn ml-auto btn-circle btn-ghost btn-sm"
					aria-label="Close"
					onclick={() => (wizardOpen = false)}
				>
					<i class="las la-times text-lg" aria-hidden="true"></i>
				</button>
			</div>

			{#if wizardStep === 1}
				<div class="px-6 py-2">
					{#each providerServices as service (service.id)}
						{@const taken = inContract(service.id)}
						<label
							class={[
								'flex items-start gap-3 border-b border-base-200 py-3 last:border-b-0',
								taken ? 'opacity-50' : 'cursor-pointer'
							]}
						>
							<input
								type="radio"
								class="radio mt-0.5 radio-sm radio-primary"
								name="wizard-service"
								value={service.id}
								disabled={taken}
								bind:group={pickedServiceId}
							/>
							<span class="min-w-0 flex-1">
								<span class="block text-[13.5px] font-semibold text-base-content">
									{service.name}
								</span>
								<span class="block text-[11.5px] text-base-content-muted">
									{taken
										? 'Already in this contract'
										: `Listed rate $${centsToDollars(service.hourlyRateCents)}/hr`}
								</span>
							</span>
						</label>
					{/each}
				</div>
				<div class="flex items-center gap-2.5 px-6 pt-2 pb-5">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={!pickedService || inContract(pickedService.id)}
						onclick={toStepTwo}
					>
						Next — rate &amp; hours
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (wizardOpen = false)}>
						Cancel
					</button>
				</div>
			{:else}
				<div class="flex flex-col gap-4 px-6 py-4">
					<div class="flex gap-4">
						<div class="flex-1">
							<label
								class="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
								for="wizard-rate"
							>
								Your rate
							</label>
							<label class="input input-sm flex w-full items-center gap-1 text-[13px]">
								$
								<input
									id="wizard-rate"
									type="text"
									inputmode="decimal"
									class="min-w-0 grow"
									bind:value={rateInput}
								/>
								<span class="text-outline">/hr</span>
							</label>
						</div>
						<div class="flex-1">
							<span
								class="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
							>
								Weekly hours
							</span>
							<div
								class="flex items-center justify-between rounded-pill border border-outline-variant
									bg-base-100 px-1.5 py-0.5"
							>
								<button
									type="button"
									class="btn btn-circle btn-ghost btn-xs text-secondary"
									aria-label="Fewer hours"
									disabled={hours <= 1}
									onclick={() => (hours = Math.max(1, hours - 1))}
								>
									−
								</button>
								<span class="text-[13px] font-semibold whitespace-nowrap text-base-content">
									{hours} hrs/wk
								</span>
								<button
									type="button"
									class="btn btn-circle btn-ghost btn-xs text-secondary"
									aria-label="More hours"
									disabled={hours >= 100}
									onclick={() => (hours = Math.min(100, hours + 1))}
								>
									+
								</button>
							</div>
						</div>
					</div>
					{#if rateError}
						<p class="-mt-2 text-[12px] font-medium text-error" role="alert">{rateError}</p>
					{:else}
						<p class="-mt-2 text-[11px] text-outline">
							Starts at the listed rate — you can offer more, never less.
						</p>
					{/if}

					<div>
						<label
							class="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
							for="wizard-expectations"
						>
							Your expectations
						</label>
						<textarea
							id="wizard-expectations"
							class="textarea w-full text-[13px] leading-relaxed"
							rows={3}
							maxlength={2000}
							placeholder="What does a good week look like for this service?"
							bind:value={expectations}
						></textarea>
						<p class="mt-1 text-[11px] text-outline">Becomes part of the contract.</p>
					</div>

					{#if wizardLineCents !== null}
						<div class="flex items-center justify-between rounded-lg bg-base-300 px-4 py-2.5">
							<span class="text-[12px] text-neutral">
								Adds to weekly estimate ({hours} × ${rateInput || '0'})
							</span>
							<span class="font-display text-sm font-bold text-secondary">
								${centsToDollars(wizardLineCents)}/wk
							</span>
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-2.5 px-6 pt-1 pb-5">
					<button type="button" class="btn btn-primary btn-sm" onclick={commitWizard}>
						{editingServiceId ? 'Save changes' : 'Add to contract'}
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onclick={() => (editingServiceId ? (wizardOpen = false) : (wizardStep = 1))}
					>
						{editingServiceId ? 'Cancel' : 'Back'}
					</button>
				</div>
			{/if}
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (wizardOpen = false)}
			aria-label="Close"
		></button>
	</div>
{/if}

<ConfirmDialog
	open={removeCandidate !== null}
	title="Remove this service?"
	body={removeCandidate
		? `“${removeCandidate.name}” comes off the terms — its rate, hours and expectations are discarded.`
		: ''}
	confirmLabel="Remove service"
	onconfirm={removeConfirmed}
	oncancel={() => (removeCandidate = null)}
/>
