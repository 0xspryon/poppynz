<script lang="ts">
	/** A contract's billing (piece 3): where the schedule stands — waiting for
	 * the helper's payout account, scheduled, running, suspended, cancelled —
	 * and each 3-day cycle with the viewer's own amount (the family's charge,
	 * or the helper's share after commission and tax). */
	import type { ResolvedPathname } from '$app/types';
	import type { ContractBilling, ContractBillingCycle } from '$lib/api/contracts';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { centsToDollars } from '$lib/money';

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
					: 'the first payment';
				return isFamily
					? {
							tone: 'info',
							text: `Waiting for ${counterpartFirstName} to finish setting up payouts. Nothing is charged until then; if it isn't ready by ${by}, the contract is cancelled.`
						}
					: {
							tone: 'warning',
							text: `Set up your payout account by ${by} — until then the family isn't charged and the contract can't start. After that it is cancelled.`,
							link: { href: payoutsHref, label: 'Set up payouts' }
						};
			}
			case 'scheduled':
				return {
					tone: 'info',
					text: isFamily
						? "Billing is scheduled: each cycle's amount is held on your card 2 days before it starts."
						: 'Billing is scheduled: each cycle is charged to the family before it starts.'
				};
			case 'suspended':
				if (billing.suspendedReason === 'card') {
					return isFamily
						? {
								tone: 'error',
								text: 'Your card was declined, so the contract is suspended. Suspended days are never billed. Replace your card to resume — the rest of the current cycle is charged straight away.',
								link: { href: billingHref, label: 'Update your card' }
							}
						: {
								tone: 'error',
								text: `The family's payment didn't go through, so the contract is suspended. Don't work suspended days — they are never billed. We'll email you when it resumes.`
							};
				}
				if (billing.suspendedReason === 'helper_not_ready') {
					return isFamily
						? {
								tone: 'warning',
								text: `${counterpartFirstName}'s payout account needs attention, so sessions are on hold and you aren't charged. It resumes by itself once their account is ready.`
							}
						: {
								tone: 'error',
								text: "Your payout account isn't ready, so sessions are on hold and the family isn't charged. Fix it to resume.",
								link: { href: payoutsHref, label: 'Fix payouts' }
							};
				}
				return {
					tone: 'warning',
					text: "We couldn't reach our payment provider in time, so the current sessions are on hold. Nobody needs to do anything — we retry automatically."
				};
			case 'cancelled':
				return {
					tone: 'info',
					text: isFamily
						? `Cancelled before it started because ${counterpartFirstName}'s payout account wasn't ready in time. Nothing was charged.`
						: "Cancelled before it started because your payout account wasn't ready in time. Nothing was charged."
				};
			case 'ended':
				return { tone: 'success', text: 'Billing for this contract has finished.' };
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
				return { status: 'empty', label: 'Upcoming' };
			case 'authorising':
			case 'capturing':
				return { status: 'in-progress', label: 'Processing' };
			case 'authorised':
				return { status: 'in-progress', label: isFamily ? 'On hold' : 'Funds on hold' };
			case 'grace':
				return {
					status: 'missing',
					label: isFamily ? 'Card declined — retrying' : 'Payment pending'
				};
			case 'captured':
				return { status: 'approved', label: isFamily ? 'Paid' : 'Funded' };
			case 'suspended':
				return { status: 'rejected', label: 'Suspended — not billed' };
			case 'capture_failed':
				return { status: 'missing', label: isFamily ? 'Payment issue' : 'Funded by Poppynz' };
			case 'cancelled':
				return { status: 'expired', label: 'Cancelled' };
			case 'carried':
				return { status: 'empty', label: 'Carried to next cycle' };
			case 'empty':
				return { status: 'empty', label: 'Nothing to bill' };
		}
	};

	const hours = (minutes: number) => {
		const value = minutes / 60;
		return Number.isInteger(value) ? `${value}` : value.toFixed(1);
	};

	// The most recent cycles first is noisy for a schedule; show the last few
	// in date order.
	const shown = $derived(billing.cycles.slice(-8));
</script>

<section
	class="rounded-xl border border-card-border bg-base-100 px-5 py-4"
	data-testid="contract-billing"
>
	<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">Billing</h3>

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
			Cycles appear here two weeks before they start.
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
							{cycle.sessionCount}
							{cycle.sessionCount === 1 ? 'session' : 'sessions'} · {hours(cycle.minutes)} hrs
							{#if cycle.status === 'scheduled'}
								· {isFamily ? 'held' : 'charged'} from {formatDateTime(cycle.holdAt)}
							{/if}
							{#if cycle.taxLines.length > 0}
								<!-- B7: the helper's amount is what's left after the deduction — never "incl." -->
								{#if isFamily}
									· incl. {cycle.taxLines.map((line) => line.label).join(', ')}
								{:else}
									· your share after Poppynz commission · tax applied: {cycle.taxLines
										.map((line) => line.label)
										.join(', ')}
								{/if}
							{/if}
						</span>
					</span>
					{#if cycle.amountCents !== null}
						<span class="tabular-nums font-semibold text-base-content">
							${centsToDollars(cycle.amountCents)}
						</span>
					{/if}
					<StatusChip status={chip.status} label={chip.label} />
				</li>
			{/each}
		</ul>
		{#if isFamily}
			<p class="mt-2 text-[11px] text-outline">
				Charges also appear in <a class="underline" href={billingHref}>Billing</a> with their receipts.
			</p>
		{/if}
	{/if}
</section>
