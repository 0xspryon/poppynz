<script lang="ts">
	/** A contract's billing (piece 3): where the schedule stands — waiting for
	 * the helper's payout account, scheduled, running, suspended, cancelled —
	 * and each 3-day cycle with the viewer's own amount (the family's charge,
	 * or the helper's share after commission and tax). */
	import type { ResolvedPathname } from '$app/types';
	import type { ContractBilling, ContractBillingCycle } from '$lib/api/contracts';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { formatNumber } from '$lib/locale';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { localizeTaxLabel } from '$lib/tax-label';

	interface Props {
		billing: ContractBilling;
		viewerSide: 'family' | 'provider';
		counterpartFirstName: string;
		billingHref: ResolvedPathname;
		payoutsHref: ResolvedPathname;
	}

	let { billing, viewerSide, counterpartFirstName, billingHref, payoutsHref }: Props = $props();

	const isFamily = $derived(viewerSide === 'family');

	type Banner = {
		tone: 'info' | 'warning' | 'error' | 'success';
		text: string;
		link?: { href: ResolvedPathname; label: string };
	};

	const banner = $derived.by((): Banner | null => {
		switch (billing.status) {
			case 'awaiting_payment_readiness': {
				const by = billing.readinessDeadline
					? formatDateTime(billing.readinessDeadline)
					: m.contracts_billing_first_payment();
				return isFamily
					? {
							tone: 'info',
							text: m.contracts_billing_awaiting_family({ name: counterpartFirstName, by })
						}
					: {
							tone: 'warning',
							text: m.contracts_billing_awaiting_provider({ by }),
							link: { href: payoutsHref, label: m.contracts_billing_setup_payouts() }
						};
			}
			case 'scheduled':
				return {
					tone: 'info',
					text: isFamily
						? m.contracts_billing_scheduled_family()
						: m.contracts_billing_scheduled_provider()
				};
			case 'suspended':
				if (billing.suspendedReason === 'card') {
					return isFamily
						? {
								tone: 'error',
								text: m.contracts_billing_card_declined_family(),
								link: { href: billingHref, label: m.contracts_billing_update_card() }
							}
						: {
								tone: 'error',
								text: m.contracts_billing_card_declined_provider()
							};
				}
				if (billing.suspendedReason === 'helper_not_ready') {
					return isFamily
						? {
								tone: 'warning',
								text: m.contracts_billing_helper_not_ready_family({ name: counterpartFirstName })
							}
						: {
								tone: 'error',
								text: m.contracts_billing_helper_not_ready_provider(),
								link: { href: payoutsHref, label: m.contracts_billing_fix_payouts() }
							};
				}
				return {
					tone: 'warning',
					text: m.contracts_billing_processor_outage()
				};
			case 'cancelled':
				return {
					tone: 'info',
					text: isFamily
						? m.contracts_billing_cancelled_family({ name: counterpartFirstName })
						: m.contracts_billing_cancelled_provider()
				};
			case 'ended':
				return { tone: 'success', text: m.contracts_billing_ended() };
			default:
				return null;
		}
	});

	const toneClass: Record<Banner['tone'], string> = {
		info: 'bg-info-content text-info',
		warning: 'bg-warning-content text-warning',
		error: 'bg-error-content text-error',
		success: 'bg-success-content text-success'
	};

	const cycleChip = (cycle: ContractBillingCycle): { status: ChipStatus; label: string } => {
		switch (cycle.status) {
			case 'scheduled':
				return { status: 'empty', label: m.contracts_cycle_upcoming() };
			case 'authorising':
			case 'capturing':
				return { status: 'in-progress', label: m.contracts_cycle_processing() };
			case 'authorised':
				return {
					status: 'in-progress',
					label: isFamily ? m.contracts_cycle_on_hold() : m.contracts_cycle_funds_on_hold()
				};
			case 'grace':
				return {
					status: 'missing',
					label: isFamily ? m.contracts_cycle_card_declined() : m.contracts_cycle_payment_pending()
				};
			case 'captured':
				return {
					status: 'approved',
					label: isFamily ? m.contracts_cycle_paid() : m.contracts_cycle_funded()
				};
			case 'suspended':
				return { status: 'rejected', label: m.contracts_cycle_suspended() };
			case 'capture_failed':
				return {
					status: 'missing',
					label: isFamily
						? m.contracts_cycle_payment_issue()
						: m.contracts_cycle_funded_by_poppynz()
				};
			case 'cancelled':
				return { status: 'expired', label: m.contracts_cycle_cancelled() };
			case 'carried':
				return { status: 'empty', label: m.contracts_cycle_carried() };
			case 'empty':
				return { status: 'empty', label: m.contracts_cycle_empty() };
		}
	};

	const hours = (minutes: number) => formatNumber(minutes / 60, { maximumFractionDigits: 1 });

	const taxLabels = (cycle: ContractBillingCycle) =>
		cycle.taxLines.map((line) => localizeTaxLabel(line.label)).join(', ');

	// The most recent cycles first is noisy for a schedule; show the last few
	// in date order.
	const shown = $derived(billing.cycles.slice(-8));
</script>

<section
	class="rounded-xl border border-card-border bg-base-100 px-5 py-4"
	data-testid="contract-billing"
>
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
		{m.contracts_billing_heading()}
	</h3>

	{#if banner}
		<div
			class={['mb-3 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed', toneClass[banner.tone]]}
		>
			{banner.text}
			{#if banner.link}
				<a class="ml-1 font-semibold underline" href={banner.link.href}>{banner.link.label}</a>
			{/if}
		</div>
	{/if}

	{#if shown.length === 0}
		<p class="text-[12.5px] text-base-content-muted">
			{m.contracts_billing_no_cycles()}
		</p>
	{:else}
		<ul class="divide-y divide-base-300">
			{#each shown as cycle (cycle.id)}
				{@const chip = cycleChip(cycle)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
					<span class="min-w-0 flex-1 font-medium text-base-content">
						{formatDateWithWeekday(cycle.startsOn)}{cycle.endsOn !== cycle.startsOn
							? ` – ${formatDateWithWeekday(cycle.endsOn)}`
							: ''}
						<span class="block text-[11.5px] font-normal text-outline">
							{m.contracts_session_count({ count: cycle.sessionCount })} · {m.contracts_hours_short(
								{
									hours: hours(cycle.minutes)
								}
							)}
							{#if cycle.status === 'scheduled'}
								· {isFamily
									? m.contracts_billing_held_from({ date: formatDateTime(cycle.holdAt) })
									: m.contracts_billing_charged_from({ date: formatDateTime(cycle.holdAt) })}
							{/if}
							{#if cycle.taxLines.length > 0}
								<!-- B7: the helper's amount is what's left after the deduction — never "incl." -->
								{#if isFamily}
									· {m.contracts_billing_incl_tax({ taxes: taxLabels(cycle) })}
								{:else}
									· {m.contracts_billing_provider_share()} · {m.contracts_billing_tax_applied({
										taxes: taxLabels(cycle)
									})}
								{/if}
							{/if}
						</span>
					</span>
					{#if cycle.amountCents !== null}
						<span class="tabular-nums font-semibold text-base-content">
							{formatMoney(cycle.amountCents)}
						</span>
					{/if}
					<StatusChip status={chip.status} label={chip.label} />
				</li>
			{/each}
		</ul>
		{#if isFamily}
			<p class="mt-2 text-[11px] text-outline">
				{m.contracts_billing_receipts_before()}
				<a class="underline" href={billingHref}>{m.contracts_billing_receipts_link()}</a>
				{m.contracts_billing_receipts_after()}
			</p>
		{/if}
	{/if}
</section>
