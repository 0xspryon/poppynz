<script lang="ts">
	/** One billing cycle of a contract (UAT round 2 #11a), for its family and
	 * helper: dates and status, when the hold, the charge (and, for the helper,
	 * the transfer) happen in the viewer's own time zone, the viewer's amounts,
	 * and the timetable of the cycle's sessions in the contract zone, with the
	 * session-window explainer (Tier 3). Each session row keeps a separate
	 * actions slot, filled by the routes with the session's resolution and
	 * the viewer's actions (cancellations, days off, reports, disputes) — it
	 * renders nothing until a `sessionActions` snippet is passed. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		getContractCycle,
		type ContractCycleDetail,
		type ContractCycleSession
	} from '$lib/api/contracts';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import SessionWindowNote from '$lib/components/sessions/SessionWindowNote.svelte';
	import { retryPaymentWithToast } from '$lib/contract-retry';
	import { cycleChip, sessionChip } from '$lib/contract-cycle-status';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatNumber } from '$lib/locale';
	import { formatMoney } from '$lib/money';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
	import { localizeTaxLabel } from '$lib/tax-label';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
		/** Per-session actions (Tier 3). Nothing is rendered without it. The
		 * third argument refetches the cycle after a change. */
		sessionActions?: Snippet<[ContractCycleSession, ContractCycleDetail, () => void]>;
	}

	let { role, sessionActions }: Props = $props();

	const contractId = $derived(page.params.id ?? '');
	const cycleId = $derived(page.params.cycleId ?? '');

	let cycle = $state<ContractCycleDetail | null>(null);
	let loading = $state(true);
	let loadState = $state<'ok' | 'error' | 'not_found'>('ok');
	let retrying = $state(false);

	const contractHref = $derived(
		role === 'family'
			? resolve('/family/contracts/[id]', { id: contractId })
			: resolve('/service-provider/contracts/[id]', { id: contractId })
	);

	// Only the newest in-flight response may land (realtime refreshes overlap).
	let refreshSeq = 0;
	async function refresh(id: string, forCycleId: string) {
		refreshSeq += 1;
		const seq = refreshSeq;
		const result = await getContractCycle(id, forCycleId);
		if (seq !== refreshSeq || id !== contractId || forCycleId !== cycleId) return;
		loading = false;
		if (result.ok) {
			cycle = result.data.cycle;
			loadState = 'ok';
		} else if (cycle === null) {
			loadState =
				result.error.code === 'CONTRACT_CYCLE_NOT_FOUND' ||
				result.error.code === 'CONTRACT_NOT_FOUND'
					? 'not_found'
					: 'error';
		}
	}

	$effect(() => {
		const id = contractId;
		const forCycleId = cycleId;
		if (!id || !forCycleId) return;
		cycle = null;
		loading = true;
		loadState = 'ok';
		void refresh(id, forCycleId);
	});

	onMount(() => {
		// Billing moved on (hold, charge, suspension, resume), or one of the
		// sessions did (Tier 3: recorded, answered, lapsed, decided): refetch.
		const offBilling = notifications.on('contract.billing', (event) => {
			if (event.payload.contractId === contractId) void refresh(contractId, cycleId);
		});
		const offSession = notifications.on('contract.session', (event) => {
			if (event.payload.contractId === contractId) void refresh(contractId, cycleId);
		});
		return () => {
			offBilling();
			offSession();
		};
	});

	async function handleRetry() {
		if (retrying) return;
		retrying = true;
		await retryPaymentWithToast(contractId);
		retrying = false;
		void refresh(contractId, cycleId);
	}

	const isFamily = $derived(cycle?.viewerSide === 'family');
	const chip = $derived(cycle ? cycleChip(cycle.status, isFamily) : null);
	const dates = $derived(
		cycle
			? cycle.endsOn !== cycle.startsOn
				? `${formatDateWithWeekday(cycle.startsOn)} – ${formatDateWithWeekday(cycle.endsOn)}`
				: formatDateWithWeekday(cycle.startsOn)
			: ''
	);
	const percent = (bps: number) =>
		formatNumber(bps / 10_000, { style: 'percent', maximumFractionDigits: 3 });
	const hours = (minutes: number) => formatNumber(minutes / 60, { maximumFractionDigits: 2 });
	/** The wall-clock range in the contract zone (the weekday plays no part). */
	const timeRange = (session: ContractCycleSession) =>
		formatSessionRange({
			weekday: 0,
			startMinutes: session.startMinutes,
			endMinutes: session.endMinutes
		});
</script>

<svelte:head>
	<title>
		{cycle
			? m.contracts_cycle_page_title({ number: cycle.index + 1, name: cycle.counterpartName })
			: m.contracts_cycle_page_title_loading()}
	</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-4">
	<a
		href={contractHref}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		{m.contracts_cycle_back()}
	</a>

	{#if loading && !cycle}
		<div class="flex justify-center py-24">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if !cycle}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<p class="text-sm font-medium text-error" role="alert">
				{loadState === 'not_found' ? m.contracts_cycle_not_found() : m.contracts_cycle_load_error()}
			</p>
			{#if loadState === 'error'}
				<button
					type="button"
					class="btn btn-sm btn-primary"
					onclick={() => {
						loading = true;
						void refresh(contractId, cycleId);
					}}
				>
					<i class="las la-redo-alt" aria-hidden="true"></i>
					{m.contracts_retry()}
				</button>
			{/if}
		</div>
	{:else}
		<header class="flex flex-wrap items-center gap-x-3.5 gap-y-2">
			<div class="min-w-0 flex-1">
				<h1 class="font-display text-xl font-bold text-base-content lg:text-2xl">
					{m.contracts_cycle_heading({ number: cycle.index + 1 })}
				</h1>
				<p class="text-sm text-base-content-muted">{dates}</p>
				<p class="text-xs text-outline">
					{m.contracts_cycle_with({ name: cycle.counterpartName })}
				</p>
			</div>
			{#if chip}
				<StatusChip status={chip.status} label={chip.label} />
			{/if}
		</header>

		{#if isFamily && cycle.canRetryPayment}
			<div
				class="flex flex-wrap items-center gap-3 rounded-lg border border-error/30 bg-error-content px-4 py-3"
			>
				<i class="las la-exclamation-circle shrink-0 text-error" aria-hidden="true"></i>
				<p class="min-w-0 flex-1 text-[12.5px] leading-relaxed text-error">
					{m.contracts_cycle_retry_body()}
				</p>
				<button
					type="button"
					class="btn gap-1.5 btn-sm btn-primary"
					disabled={retrying}
					onclick={() => void handleRetry()}
					data-testid="retry-payment"
				>
					{#if retrying}
						<span class="loading loading-xs loading-spinner"></span>
						{m.contracts_billing_retrying()}
					{:else}
						<i class="las la-redo-alt" aria-hidden="true"></i>
						{m.contracts_billing_retry()}
					{/if}
				</button>
			</div>
		{/if}

		<div class="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
			<section
				class="min-w-0 rounded-xl border border-card-border bg-base-100 px-5 py-4"
				data-testid="cycle-sessions"
			>
				<div class="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
					<h2 class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{m.contracts_cycle_sessions_heading()}
					</h2>
					<p class="text-[11px] text-outline">
						{m.contracts_cycle_sessions_zone({ zone: cycle.timeZoneLabel })}
					</p>
				</div>
				<div class="mb-3">
					<SessionWindowNote
						windowDays={cycle.sessionWindow.windowDays}
						cancellationNoticeHours={cycle.sessionWindow.cancellationNoticeHours}
					/>
				</div>
				{#if cycle.sessions.length === 0}
					<p class="text-[12.5px] text-base-content-muted">{m.contracts_cycle_no_sessions()}</p>
				{:else}
					<div class="-mx-5 overflow-x-auto px-5">
						<table class="table w-full table-sm text-[13px]">
							<thead>
								<tr class="text-[11px] text-outline">
									<th scope="col">{m.contracts_cycle_col_date()}</th>
									<th scope="col">{m.contracts_cycle_col_service()}</th>
									<th scope="col">{m.contracts_cycle_col_time()}</th>
									<th scope="col" class="text-right">{m.contracts_cycle_col_hours()}</th>
									<th scope="col">{m.contracts_cycle_col_status()}</th>
								</tr>
							</thead>
							<tbody>
								{#each cycle.sessions as session (session.id)}
									{@const status = sessionChip(session.status)}
									<tr data-testid="cycle-session" class={sessionActions ? 'border-b-0' : ''}>
										<td class="whitespace-nowrap">{formatDateWithWeekday(session.date)}</td>
										<td class="max-w-[12rem] truncate" title={session.serviceName ?? undefined}>
											{session.serviceName ?? '—'}
										</td>
										<td class="whitespace-nowrap tabular-nums">{timeRange(session)}</td>
										<td class="text-right tabular-nums">
											{m.contracts_hours_short({ hours: hours(session.elapsedMinutes) })}
										</td>
										<td><StatusChip status={status.status} label={status.label} /></td>
									</tr>
									<!-- Tier 3: the session's resolution and actions, on their own
									     full-width row under its facts, so they stay readable and in
									     view on a phone instead of in a squeezed, scrolled-off column. -->
									{#if sessionActions}
										<tr>
											<td colspan="5" class="pt-0" data-testid="cycle-session-actions">
												{@render sessionActions(
													session,
													cycle,
													() => void refresh(contractId, cycleId)
												)}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>

			<div class="flex flex-col gap-4">
				<section class="rounded-xl border border-card-border bg-base-100 px-5 py-4">
					<h2 class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{m.contracts_cycle_times_heading()}
					</h2>
					<p class="mb-2 text-[11px] text-outline">{m.contracts_cycle_times_hint()}</p>
					<dl class="flex flex-col gap-1.5 text-[13px]">
						<div class="flex justify-between gap-3">
							<dt class="text-base-content-muted">
								{isFamily ? m.contracts_cycle_hold_family() : m.contracts_cycle_hold_provider()}
							</dt>
							<dd class="text-right text-base-content">{formatDateTime(cycle.holdAt)}</dd>
						</div>
						<div class="flex justify-between gap-3">
							<dt class="text-base-content-muted">
								{isFamily
									? m.contracts_cycle_capture_family()
									: m.contracts_cycle_capture_provider()}
							</dt>
							<dd class="text-right text-base-content">{formatDateTime(cycle.captureAt)}</dd>
						</div>
						{#if cycle.transferAt}
							<div class="flex justify-between gap-3">
								<dt class="text-base-content-muted">{m.contracts_cycle_transfer()}</dt>
								<dd class="text-right text-base-content">{formatDateTime(cycle.transferAt)}</dd>
							</div>
						{/if}
					</dl>
				</section>

				<section
					class="rounded-xl border border-card-border bg-base-100 px-5 py-4"
					data-testid="cycle-amounts"
				>
					<h2 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{isFamily ? m.contracts_cycle_amounts_family() : m.contracts_cycle_amounts_provider()}
					</h2>
					{#if cycle.amounts === null}
						<p class="text-[12.5px] leading-relaxed text-base-content-muted">
							{m.contracts_cycle_not_quoted({
								date: formatDateTime(cycle.holdAt),
								amount: formatMoney(cycle.estimatedServiceCents)
							})}
						</p>
					{:else}
						<dl class="flex flex-col gap-1.5 text-[13px]">
							<div class="flex justify-between gap-3">
								<dt class="text-base-content-muted">{m.contracts_price_care()}</dt>
								<dd class="tabular-nums">{formatMoney(cycle.amounts.serviceCents)}</dd>
							</div>
							{#each cycle.amounts.serviceTaxLines as line (line.label)}
								<div class="flex justify-between gap-3">
									<dt class="text-base-content-muted">{localizeTaxLabel(line.label)}</dt>
									<dd class="tabular-nums">+{formatMoney(line.taxCents)}</dd>
								</div>
							{/each}
							{#if cycle.amounts.side === 'family'}
								<div class="flex justify-between gap-3">
									<dt class="text-base-content-muted">
										{m.contracts_price_service_fee({ percent: percent(cycle.amounts.feeBps) })}
									</dt>
									<dd class="tabular-nums">+{formatMoney(cycle.amounts.feeCents)}</dd>
								</div>
								{#each cycle.amounts.feeTaxLines as line (line.label)}
									<div class="flex justify-between gap-3">
										<dt class="text-base-content-muted">
											{m.contracts_price_tax_on_fee({ tax: localizeTaxLabel(line.label) })}
										</dt>
										<dd class="tabular-nums">+{formatMoney(line.taxCents)}</dd>
									</div>
								{/each}
								<div
									class="mt-1 flex justify-between gap-3 border-t border-base-300 pt-1.5 font-semibold"
								>
									<dt class="text-base-content">{m.contracts_price_you_pay()}</dt>
									<dd class="tabular-nums text-secondary">
										{formatMoney(cycle.amounts.totalCents)}
									</dd>
								</div>
								{#if cycle.amounts.chargedCents !== null && cycle.amounts.chargedCents !== cycle.amounts.totalCents}
									<div class="flex justify-between gap-3">
										<dt class="text-base-content-muted">{m.contracts_cycle_charged()}</dt>
										<dd class="tabular-nums">{formatMoney(cycle.amounts.chargedCents)}</dd>
									</div>
								{/if}
							{:else}
								<div class="flex justify-between gap-3">
									<dt class="text-base-content-muted">
										{m.contracts_price_commission({
											percent: percent(cycle.amounts.commissionBps)
										})}
									</dt>
									<dd class="tabular-nums">−{formatMoney(cycle.amounts.commissionCents)}</dd>
								</div>
								{#each cycle.amounts.commissionTaxLines as line (line.label)}
									<div class="flex justify-between gap-3">
										<dt class="text-base-content-muted">
											{m.contracts_price_tax_on_commission({ tax: localizeTaxLabel(line.label) })}
										</dt>
										<dd class="tabular-nums">−{formatMoney(line.taxCents)}</dd>
									</div>
								{/each}
								<div
									class="mt-1 flex justify-between gap-3 border-t border-base-300 pt-1.5 font-semibold"
								>
									<dt class="text-base-content">{m.contracts_price_you_receive()}</dt>
									<dd class="tabular-nums text-secondary">
										{formatMoney(cycle.amounts.shareCents)}
									</dd>
								</div>
							{/if}
						</dl>
					{/if}
					{#if cycle.carriedInCents > 0}
						<p class="mt-2 text-[11px] leading-relaxed text-outline">
							{m.contracts_cycle_carried_in({ amount: formatMoney(cycle.carriedInCents) })}
						</p>
					{/if}
				</section>
			</div>
		</div>
	{/if}
</div>
