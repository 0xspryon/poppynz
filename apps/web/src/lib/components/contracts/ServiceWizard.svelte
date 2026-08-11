<script lang="ts" module>
	/** One selectable service from the provider's current listing. */
	export type WizardService = { id: string; name: string; hourlyRateCents: number };

	/** One configured line item — the wizard's result and the draft's rows. */
	export type ServiceLineItem = {
		serviceId: string;
		name: string;
		listedRateCents: number;
		rateCents: number;
		sessions: ContractSession[];
		expectations: string;
	};
</script>

<script lang="ts">
	/** Add-a-service wizard (Flow F): a full-screen takeover with three steps —
	 * pick a service, set rate & expectations, propose weekly sessions on an
	 * empty week grid. The provider publishes no availability: the family
	 * authors the schedule from scratch and the provider clash-checks at
	 * review. Overlaps are warned, never blocked. */
	import type { ResolvedPathname } from '$app/types';
	import {
		WEEKDAY_LABELS,
		bySessionStart,
		formatMinutes,
		formatSessionRange,
		minutesToHours,
		overlapping,
		serviceCode,
		serviceWeeklyCents,
		sessionMinutes,
		weeklyMinutes,
		type ContractSession
	} from '$lib/contract-sessions';
	import { formatDateWithWeekday } from '$lib/date';
	import { centsToDollars, dollarsToCents } from '$lib/money';

	interface Props {
		/** The provider's current listing — the selectable set and rate floors. */
		providerServices: WizardService[];
		/** Every line item already on the draft: disables taken services and
		 * paints their sessions into the grid so the family doesn't overlap
		 * themselves. */
		draftItems: ServiceLineItem[];
		/** Reopen pre-filled for this item (starts at step 2, service fixed). */
		editing?: ServiceLineItem | null;
		/** "Maria's listing" — the step-1 subtitle. */
		listingLabel: string;
		counterpartFirstName: string;
		/** The draft's start date, for the "repeats weekly from" copy. */
		startsOn?: string | null;
		/** Chat deep-link for the missing-service dialog. */
		chatHref?: ResolvedPathname | null;
		oncommit: (item: ServiceLineItem) => void;
		oncancel: () => void;
	}

	let {
		providerServices,
		draftItems,
		editing = null,
		listingLabel,
		counterpartFirstName,
		startsOn = null,
		chatHref = null,
		oncommit,
		oncancel
	}: Props = $props();

	// Capture-once seeds (the wizard owns its state after mount).
	// svelte-ignore state_referenced_locally
	let step = $state<1 | 2 | 3>(editing ? 2 : 1);
	// svelte-ignore state_referenced_locally
	let pickedServiceId = $state<string | null>(editing?.serviceId ?? null);
	// svelte-ignore state_referenced_locally
	let rateInput = $state(editing ? centsToDollars(editing.rateCents) : '');
	// svelte-ignore state_referenced_locally
	let expectations = $state(editing?.expectations ?? '');
	// svelte-ignore state_referenced_locally
	let sessions = $state<ContractSession[]>((editing?.sessions ?? []).map((s) => ({ ...s })));
	let rateError = $state<string | null>(null);
	let sessionsError = $state<string | null>(null);
	let missingServiceOpen = $state(false);

	// Inline per-day session editor. "+ Add time" pre-fills from the most
	// recently entered times so a repeating week is two clicks per day.
	const DEFAULT_TIMES = { startMinutes: 15 * 60 + 30, endMinutes: 18 * 60 };
	// svelte-ignore state_referenced_locally
	let lastTimes = $state(
		editing && editing.sessions.length > 0
			? {
					startMinutes: editing.sessions[editing.sessions.length - 1].startMinutes,
					endMinutes: editing.sessions[editing.sessions.length - 1].endMinutes
				}
			: DEFAULT_TIMES
	);
	let editorDay = $state<number | null>(null);
	let editorStart = $state(DEFAULT_TIMES.startMinutes);
	let editorEnd = $state(DEFAULT_TIMES.endMinutes);

	const otherItems = $derived(
		draftItems.filter((item) => item.serviceId !== (editing?.serviceId ?? pickedServiceId))
	);
	const inDraft = (id: string) =>
		id !== editing?.serviceId && draftItems.some((item) => item.serviceId === id);

	// Editing falls back to the item's own snapshot when the service was
	// delisted — Edit must never be a silent no-op.
	const pickedService = $derived.by(() => {
		const listed = providerServices.find((service) => service.id === pickedServiceId) ?? null;
		if (listed) return listed;
		return editing
			? { id: editing.serviceId, name: editing.name, hourlyRateCents: editing.listedRateCents }
			: null;
	});

	const rateCents = $derived(dollarsToCents(rateInput));
	const totalMinutes = $derived(weeklyMinutes(sessions));
	const weeklyCents = $derived(rateCents !== null ? serviceWeeklyCents(rateCents, sessions) : null);

	/** Every session already in the draft for `weekday`, labelled: the current
	 * service's own rows plus other services' rows (with their code). */
	const daySessions = (weekday: number) => {
		const own = sessions
			.map((session, index) => ({ kind: 'own' as const, session, index }))
			.filter((entry) => entry.session.weekday === weekday);
		const others = otherItems.flatMap((item) =>
			item.sessions
				.filter((session) => session.weekday === weekday)
				.map((session) => ({ kind: 'other' as const, session, name: item.name }))
		);
		return [...own, ...others].sort((a, b) => bySessionStart(a.session, b.session));
	};

	const allDraftSessions = $derived([...sessions, ...otherItems.flatMap((item) => item.sessions)]);

	const overlapsOf = (session: ContractSession, skipIndex: number | null) =>
		overlapping(session, [
			...sessions.filter((_, index) => index !== skipIndex),
			...otherItems.flatMap((item) => item.sessions)
		]);

	const editorCandidate = $derived(
		editorDay !== null
			? { weekday: editorDay, startMinutes: editorStart, endMinutes: editorEnd }
			: null
	);
	const editorOverlaps = $derived(
		editorCandidate !== null ? overlapping(editorCandidate, allDraftSessions) : []
	);

	// 15-minute wall-clock steps across the whole day (NZ local time).
	const TIME_STEP = 15;
	const startOptions = Array.from({ length: (24 * 60) / TIME_STEP }, (_, i) => i * TIME_STEP);
	const endOptions = $derived(
		startOptions.map((minutes) => minutes + TIME_STEP).filter((minutes) => minutes > editorStart)
	);

	function openDayEditor(weekday: number) {
		editorDay = weekday;
		editorStart = lastTimes.startMinutes;
		editorEnd = lastTimes.endMinutes;
	}

	function addSession() {
		if (editorDay === null || editorEnd <= editorStart) return;
		sessions = [
			...sessions,
			{ weekday: editorDay, startMinutes: editorStart, endMinutes: editorEnd }
		];
		lastTimes = { startMinutes: editorStart, endMinutes: editorEnd };
		sessionsError = null;
		editorDay = null;
	}

	function removeSession(index: number) {
		sessions = sessions.filter((_, i) => i !== index);
	}

	function validateRate(): number | null {
		const service = pickedService;
		if (!service) {
			rateError = 'This service is no longer available.';
			return null;
		}
		const cents = rateCents;
		if (cents === null) {
			rateError = 'Enter a valid hourly rate.';
			return null;
		}
		// Mirrors the API's floor: half the listed rate, rounded up to whole cents.
		const minRateCents = Math.ceil(service.hourlyRateCents / 2);
		if (cents < minRateCents) {
			rateError = `Starts at half the listed rate — $${centsToDollars(minRateCents)}/hr or more.`;
			return null;
		}
		// Mirrors the API's upper bound so the failure is inline, not a toast.
		if (cents > 1_000_000) {
			rateError = 'That rate looks too high — $10,000/hr is the maximum.';
			return null;
		}
		rateError = null;
		return cents;
	}

	function toStepTwo() {
		const service = pickedService;
		if (!service) return;
		if (!editing) {
			rateInput = centsToDollars(service.hourlyRateCents);
			expectations = '';
		}
		rateError = null;
		step = 2;
	}

	function toStepThree() {
		if (validateRate() === null) return;
		step = 3;
	}

	function commit() {
		const service = pickedService;
		const cents = validateRate();
		if (!service || cents === null) {
			step = 2;
			return;
		}
		if (sessions.length === 0) {
			sessionsError = 'Propose at least one weekly session.';
			return;
		}
		oncommit({
			serviceId: service.id,
			name: service.name,
			listedRateCents: service.hourlyRateCents,
			rateCents: cents,
			sessions: [...sessions].sort((a, b) => a.weekday - b.weekday || bySessionStart(a, b)),
			expectations: expectations.trim()
		});
	}

	const stepLabels = ['Service', 'Rate & expectations', 'Propose sessions'] as const;
</script>

<div
	class="fixed inset-0 z-50 flex flex-col bg-base-200"
	role="dialog"
	aria-modal="true"
	aria-label="Add a service"
>
	<!-- Stepper header -->
	<header
		class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3.5
			sm:gap-5 sm:px-7"
	>
		<div class="flex min-w-0 items-center gap-2.5">
			<span
				class="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral text-[13px]
					font-bold text-neutral-content"
			>
				{counterpartFirstName.charAt(0).toUpperCase()}
			</span>
			<div class="min-w-0">
				<h2 class="truncate font-display text-base font-bold text-base-content">
					{editing ? editing.name : 'Add a service'}
				</h2>
				<p class="truncate text-[11px] text-outline">
					From {listingLabel} · Step {step} of 3
				</p>
			</div>
		</div>
		<nav class="hidden items-center gap-2 md:flex" aria-label="Wizard steps">
			{#each stepLabels as label, index (label)}
				{@const stepNumber = index + 1}
				{#if index > 0}
					<span class="h-px w-6 bg-outline-variant" aria-hidden="true"></span>
				{/if}
				<span
					class={[
						'inline-flex items-center gap-1.5 text-xs font-semibold',
						stepNumber === step
							? 'text-secondary'
							: stepNumber < step
								? 'text-success'
								: 'text-outline'
					]}
					aria-current={stepNumber === step ? 'step' : undefined}
				>
					{#if stepNumber < step}
						<span class="flex size-5 items-center justify-center rounded-full bg-success-content">
							<i class="las la-check text-[11px] text-success" aria-hidden="true"></i>
						</span>
					{:else}
						<span
							class={[
								'flex size-5 items-center justify-center rounded-full text-[10.5px] font-bold',
								stepNumber === step
									? 'bg-secondary text-secondary-content'
									: 'border-[1.5px] border-outline-variant text-outline'
							]}
						>
							{stepNumber}
						</span>
					{/if}
					{label}
				</span>
			{/each}
		</nav>
		<button
			type="button"
			class="btn ml-auto btn-circle btn-ghost btn-sm"
			aria-label="Close without saving this service"
			onclick={oncancel}
		>
			<i class="las la-times text-lg" aria-hidden="true"></i>
		</button>
	</header>

	<!-- Step body -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if step === 1}
			<div class="mx-auto w-full max-w-xl px-4 py-8">
				<h3 class="font-display text-lg font-bold text-base-content">
					Which of {counterpartFirstName}'s services?
				</h3>
				<p class="mb-4 text-xs text-base-content-muted">
					Rate, expectations and sessions are set per service in the next two steps.
				</p>
				<div class="rounded-xl border border-card-border bg-base-100 px-5 py-1">
					{#each providerServices as service (service.id)}
						{@const taken = inDraft(service.id)}
						<label
							class={[
								'flex items-start gap-3 border-b border-base-200 py-3.5 last:border-b-0',
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
				<button
					type="button"
					class="mt-3 text-[13px] font-semibold text-secondary hover:underline"
					onclick={() => (missingServiceOpen = true)}
				>
					You don't see the service you want →
				</button>
			</div>
		{:else if step === 2}
			<div class="mx-auto w-full max-w-xl px-4 py-8">
				<h3 class="font-display text-lg font-bold text-base-content">
					{pickedService?.name ?? 'This service'} — your terms
				</h3>
				<p class="mb-4 text-xs text-base-content-muted">
					{#if pickedService}
						{counterpartFirstName}'s listed rate is ${centsToDollars(
							pickedService.hourlyRateCents
						)}/hr — offers start at half that, and you can always offer more.
					{/if}
				</p>
				<div class="flex flex-col gap-4">
					<div>
						<label
							class="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
							for="wizard-rate"
						>
							Your rate
						</label>
						<label class="input input-sm flex w-44 items-center gap-1 text-[13px]">
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
						{#if rateError}
							<p class="mt-1.5 text-[12px] font-medium text-error" role="alert">{rateError}</p>
						{/if}
					</div>
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
					<div class="flex items-start gap-2.5 rounded-lg bg-base-300 px-3.5 py-2.5">
						<i class="las la-clock mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
						<p class="text-[12px] leading-relaxed text-neutral">
							Hours come from the sessions you propose next — no need to guess a weekly number.
						</p>
					</div>
				</div>
			</div>
		{:else}
			<div class="mx-auto w-full max-w-5xl px-4 py-6">
				<div class="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<h3 class="font-display text-lg font-bold text-base-content">
						Propose your weekly schedule
					</h3>
					<p class="text-xs text-base-content-muted">
						You set the times — {counterpartFirstName} publishes no calendar. Repeats weekly{startsOn
							? ` from ${formatDateWithWeekday(startsOn)}`
							: ''} · times are NZ local time.
					</p>
				</div>

				<!-- Week grid: swipeable columns on small screens, full week on lg. -->
				<div class="flex gap-2.5 overflow-x-auto pb-2 lg:overflow-visible">
					{#each WEEKDAY_LABELS as dayLabel, weekday (dayLabel)}
						<div class="flex w-32 flex-none flex-col gap-2 lg:w-auto lg:flex-1">
							<div
								class="rounded-lg bg-base-400 py-1.5 text-center text-xs font-bold text-base-content"
							>
								{dayLabel}
							</div>
							{#each daySessions(weekday) as entry (entry.kind === 'own' ? `own-${entry.index}` : `other-${entry.name}-${entry.session.startMinutes}`)}
								{#if entry.kind === 'own'}
									{@const clashes = overlapsOf(entry.session, entry.index)}
									<div
										class="relative rounded-[10px] border-[1.5px] border-primary bg-base-300 px-2.5 py-2"
									>
										<div class="text-xs font-bold whitespace-nowrap text-secondary">
											{formatSessionRange(entry.session)}
										</div>
										<div class="mt-0.5 text-[10.5px] text-neutral">
											{minutesToHours(sessionMinutes(entry.session))} hrs
										</div>
										{#if clashes.length > 0}
											<div class="mt-0.5 text-[10.5px] font-medium text-warning">
												Overlaps another session
											</div>
										{/if}
										<button
											type="button"
											class="absolute -top-2 -right-2 flex size-[18px] items-center justify-center
												rounded-full bg-secondary text-[10px] leading-none font-semibold
												text-secondary-content shadow-[0_0_0_2px_var(--color-base-100)]"
											aria-label="Remove {dayLabel} {formatSessionRange(entry.session)}"
											onclick={() => removeSession(entry.index)}
										>
											×
										</button>
									</div>
								{:else}
									<div
										class="relative rounded-[10px] border border-base-300 bg-base-200 px-2.5 py-2"
										title="Proposed for {entry.name} in this contract"
									>
										<div class="text-xs font-bold whitespace-nowrap text-base-content-muted">
											{formatSessionRange(entry.session)}
										</div>
										<div class="mt-0.5 truncate text-[10.5px] text-outline">{entry.name}</div>
										<span
											class="absolute -top-2 -right-1.5 rounded-full bg-base-500 px-1.5 py-0.5
												text-[9px] font-bold text-info shadow-[0_0_0_2px_var(--color-base-100)]"
										>
											{serviceCode(entry.name)}
										</span>
									</div>
								{/if}
							{/each}
							{#if editorDay === weekday}
								<div
									class="flex flex-col gap-1.5 rounded-[10px] border-[1.5px] border-primary
										bg-base-100 p-2 shadow-card"
								>
									<div class="text-[9.5px] font-semibold tracking-[0.08em] text-outline uppercase">
										New session
									</div>
									<label class="flex items-center justify-between gap-1.5 text-[11px]">
										<span class="text-outline">from</span>
										<select
											class="select select-xs grow text-[11px] font-semibold"
											bind:value={editorStart}
											onchange={() => {
												if (editorEnd <= editorStart) editorEnd = editorStart + TIME_STEP;
											}}
										>
											{#each startOptions as minutes (minutes)}
												<option value={minutes}>{formatMinutes(minutes)}</option>
											{/each}
										</select>
									</label>
									<label class="flex items-center justify-between gap-1.5 text-[11px]">
										<span class="text-outline">to</span>
										<select
											class="select select-xs grow text-[11px] font-semibold"
											bind:value={editorEnd}
										>
											{#each endOptions as minutes (minutes)}
												<option value={minutes}>{formatMinutes(minutes)}</option>
											{/each}
										</select>
									</label>
									{#if editorOverlaps.length > 0}
										<p class="text-[10.5px] leading-snug font-medium text-warning">
											Overlaps a session already in this draft — allowed, but {counterpartFirstName}
											sees the whole week.
										</p>
									{/if}
									<div class="flex items-center gap-1.5">
										<button
											type="button"
											class="btn btn-primary btn-xs flex-1"
											onclick={addSession}
										>
											Add
										</button>
										<button
											type="button"
											class="btn btn-circle btn-ghost btn-xs"
											aria-label="Cancel new session"
											onclick={() => (editorDay = null)}
										>
											×
										</button>
									</div>
								</div>
							{:else}
								<button
									type="button"
									class="rounded-[10px] border-[1.5px] border-dashed border-outline-variant px-2.5
										py-2 text-[11px] font-semibold text-secondary hover:border-primary
										hover:bg-base-300"
									onclick={() => openDayEditor(weekday)}
								>
									+ Add time
								</button>
							{/if}
						</div>
					{/each}
				</div>

				<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-outline">
					<span class="inline-flex items-center gap-1.5">
						<span
							class="size-3 rounded-[4px] border-[1.5px] border-primary bg-base-300"
							aria-hidden="true"
						></span>
						Your session
					</span>
					{#if otherItems.some((item) => item.sessions.length > 0)}
						<span class="inline-flex items-center gap-1.5">
							<span class="rounded-full bg-base-500 px-1.5 py-0.5 text-[9px] font-bold text-info">
								{serviceCode(otherItems[0]?.name ?? '')}
							</span>
							Another service in this draft — so you don't overlap yourself
						</span>
					{/if}
				</div>
				{#if sessionsError}
					<p class="mt-2 text-[12px] font-medium text-error" role="alert">{sessionsError}</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<footer
		class="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-base-300 bg-base-100
			px-4 py-3 sm:px-7"
	>
		{#if step === 1}
			<button
				type="button"
				class="btn btn-primary btn-sm"
				disabled={!pickedService || inDraft(pickedService.id)}
				onclick={toStepTwo}
			>
				Next — rate &amp; expectations
			</button>
			<button type="button" class="btn btn-ghost btn-sm" onclick={oncancel}>Cancel</button>
		{:else if step === 2}
			<button type="button" class="btn btn-primary btn-sm" onclick={toStepThree}>
				Next — propose sessions
			</button>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onclick={() => (editing ? oncancel() : (step = 1))}
			>
				{editing ? 'Cancel' : 'Back'}
			</button>
		{:else}
			<button type="button" class="btn btn-primary btn-sm" onclick={commit}>
				{editing ? 'Save changes' : 'Add to contract'}
			</button>
			<button type="button" class="btn btn-outline btn-sm" onclick={() => (step = 2)}>
				Back to rate &amp; expectations
			</button>
			<span class="ml-auto hidden text-[11.5px] text-outline sm:block">
				{pickedService?.name} · {sessions.length}
				{sessions.length === 1 ? 'session' : 'sessions'} · {minutesToHours(totalMinutes)} hrs/wk
				{#if weeklyCents !== null}
					· adds <strong class="text-secondary">${centsToDollars(weeklyCents)}/wk</strong>
					at ${rateInput}/hr
				{/if}
			</span>
		{/if}
	</footer>
</div>

<!-- Missing-service dialog: services are provider-authored; the family asks in chat. -->
{#if missingServiceOpen}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label="Don't see the service you need?"
	>
		<div class="modal-box max-w-md border border-card-border">
			<div class="flex items-start gap-3">
				<span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-base-300">
					<i class="las la-search text-neutral" aria-hidden="true"></i>
				</span>
				<div class="min-w-0">
					<h3 class="font-display text-base font-bold text-base-content">
						Don't see the service you need?
					</h3>
					<p class="mt-1.5 text-[12.5px] leading-relaxed text-base-content-muted">
						You can only add services {counterpartFirstName} offers. If something's missing, ask them
						to add it to their <strong>services list</strong> — as soon as they do, it shows up here and
						you can select it.
					</p>
				</div>
			</div>
			<div class="mt-4 flex items-center gap-2.5">
				{#if chatHref}
					<a href={chatHref} class="btn btn-primary btn-sm">Message {counterpartFirstName}</a>
				{/if}
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={() => (missingServiceOpen = false)}
				>
					Back to services
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (missingServiceOpen = false)}
			aria-label="Close"
		></button>
	</div>
{/if}
