<script lang="ts">
	/** A family's card on file and payment history. The card funds contract
	 * billing, so it can be replaced but not simply removed. Receipts are
	 * Stripe's; invoices and tax receipts wait for the accountant's sign-off. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import {
		confirmCardSetup,
		getBilling,
		startCardSetup,
		type BillingData,
		type BillingPayment
	} from '$lib/api/billing';
	import PaymentModal from '$lib/components/payments/PaymentModal.svelte';
	// Tier 3 step 2: a charge's session refunds.
	import PaymentRefunds from '$lib/components/billing/PaymentRefunds.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDate } from '$lib/date';
	import { intlLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';
	import { cardExpiry, cardLabel } from '$lib/payment-cards';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';
	import { localizeTaxLabel } from '$lib/tax-label';

	const RETRY_MESSAGE = m.family_billing_retry();

	/** Where a saved card returns the family to — the draft contract that sent
	 * them here to add one. Only the family's own contract pages are honoured,
	 * so the link can't redirect anywhere else. */
	const returnTo = $derived.by(() => {
		const target = page.url.searchParams.get('returnTo');
		const contracts = `${resolve('/family/contracts')}/`;
		return target && target.startsWith(contracts) && !target.includes('//')
			? (target as ResolvedPathname)
			: null;
	});

	let billing = $state<BillingData | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);
	let starting = $state(false);
	/** The card setup the modal is confirming. */
	let setup = $state<{ setupId: string; clientSecret: string } | null>(null);

	async function load() {
		const result = await getBilling();
		if (result.ok) {
			billing = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
		}
		loading = false;
	}

	onMount(() => {
		void load();
		// A contract hold, charge or decline moved, or a session refund (issued,
		// succeeded, failed): show the fresh history.
		return notifications.on('contract.billing', () => void load());
	});

	async function addCard() {
		// One setup at a time: a second click while the form is loading
		// would confirm one intent and save another (B1).
		if (starting || setup !== null) return;
		starting = true;
		const result = await startCardSetup();
		starting = false;
		if (!result.ok) {
			toast.error(
				result.error.code === 'BILLING_PROVIDER_UNAVAILABLE'
					? m.family_billing_provider_unavailable()
					: RETRY_MESSAGE,
				{ title: m.family_billing_card_not_added_title() }
			);
			return;
		}
		setup = { setupId: result.data.setupId, clientSecret: result.data.clientSecret };
		// The mock has no card form: its setup is already complete.
		if (result.data.provider === 'mock') await setupConfirmed();
	}

	/** Confirms exactly the setup the card form was opened with. */
	async function setupConfirmed(current = setup) {
		if (!current) return;
		const result = await confirmCardSetup(current.setupId);
		setup = null;
		if (result.ok) {
			toast.success(m.family_billing_card_saved_body({ card: cardLabel(result.data.card) }), {
				title: m.family_billing_card_saved_title()
			});
			if (returnTo) {
				await goto(returnTo);
				return;
			}
			await load();
		} else {
			toast.error(
				result.error.code === 'BILLING_CARD_SETUP_INCOMPLETE'
					? m.family_billing_card_setup_incomplete()
					: RETRY_MESSAGE,
				{ title: m.family_billing_card_not_saved_title() }
			);
		}
	}

	const chip: Record<BillingPayment['status'], { status: ChipStatus; label: string }> = {
		paid: { status: 'approved', label: m.family_billing_status_paid() },
		// A hold Poppynz released: nothing was taken.
		released: { status: 'empty', label: m.family_billing_status_released() },
		refunded: { status: 'expired', label: m.family_billing_status_refunded() },
		failed: { status: 'rejected', label: m.family_billing_status_failed() },
		pending: { status: 'in-progress', label: m.family_billing_status_pending() },
		on_hold: { status: 'in-progress', label: m.family_billing_status_on_hold() }
	};

	const money = (cents: number, currency: string) =>
		new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(cents / 100);

	/** What saving the card does: nothing is charged — unless it resumes a
	 * suspended contract, whose rest of the cycle is charged at once. */
	const cardNotice = $derived.by(() => {
		const charges = billing?.resumeCharges ?? [];
		if (charges.length === 0) {
			return m.family_billing_card_notice();
		}
		const items = charges
			.map((charge) =>
				m.family_billing_resume_charge_item({
					amount: money(charge.amountCents, 'CAD'),
					dates: charge.dates
				})
			)
			.join(', ');
		return m.family_billing_card_notice_resume({ items });
	});
</script>

<svelte:head>
	<title>{m.family_billing_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.family_billing_title()}</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{m.family_billing_subtitle()}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if loadFailed || !billing}
		<p role="alert" class="text-sm font-medium text-error">{RETRY_MESSAGE}</p>
	{:else}
		<section class="rounded-xl border border-card-border bg-base-100 p-5">
			<h2 class="text-base font-semibold text-base-content">
				{m.family_billing_card_on_file()}
			</h2>
			{#if billing.card}
				<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="text-sm font-medium text-base-content">{cardLabel(billing.card)}</p>
						<p class="text-xs text-base-content-muted">
							{m.family_billing_card_expires({ expiry: cardExpiry(billing.card) })}
						</p>
					</div>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={starting || setup !== null}
						onclick={addCard}
					>
						{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
						{m.family_billing_replace_card()}
					</button>
				</div>
			{:else}
				<p class="mt-1 text-sm text-base-content-muted">
					{m.family_billing_no_card()}
				</p>
				<button
					type="button"
					class="btn btn-primary btn-sm mt-3"
					disabled={starting || setup !== null}
					onclick={addCard}
				>
					{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
					{m.family_billing_add_card()}
				</button>
			{/if}
		</section>

		<h2 class="mt-8 mb-3 text-lg font-semibold text-base-content">
			{m.family_billing_history_title()}
		</h2>
		{#if billing.payments.length === 0}
			<p class="text-sm text-base-content-muted">{m.family_billing_no_payments()}</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
				<table class="table">
					<thead>
						<tr>
							<th>{m.family_billing_col_date()}</th>
							<th>{m.family_billing_col_description()}</th>
							<th class="text-right">{m.family_billing_col_amount()}</th>
							<th>{m.family_billing_col_status()}</th>
							<th><span class="sr-only">{m.family_billing_col_receipt()}</span></th>
						</tr>
					</thead>
					<tbody>
						{#each billing.payments as row (row.id)}
							<tr>
								<td class="whitespace-nowrap">{formatDate(row.createdAt)}</td>
								<td>
									{row.description}
									{#if row.taxLines.length > 0}
										<div class="text-xs text-base-content-muted">
											{m.family_billing_taxes_included({
												taxes: row.taxLines
													.map(
														(line) =>
															`${localizeTaxLabel(line.label)} ${money(line.taxCents, row.currency)}`
													)
													.join(' · ')
											})}
										</div>
									{/if}
								</td>
								<td class="text-right tabular-nums">{money(row.totalCents, row.currency)}</td>
								<td>
									<StatusChip status={chip[row.status].status} label={chip[row.status].label} />
								</td>
								<td>
									{#if row.receiptUrl}
										<a
											class="link text-sm"
											href={row.receiptUrl}
											target="_blank"
											rel="external noopener noreferrer"
										>
											{m.family_billing_receipt()}
										</a>
									{/if}
								</td>
							</tr>
							<!-- Tier 3 step 2: the charge's session refunds, under it. -->
							{#if row.refunds && row.refunds.length > 0}
								<tr>
									<td></td>
									<td colspan="4" class="pt-0">
										<PaymentRefunds refunds={row.refunds} />
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

{#if setup && billing?.provider !== 'mock'}
	{@const opened = setup}
	{#key opened.clientSecret}
		<PaymentModal
			mode="setup"
			clientSecret={opened.clientSecret}
			title={billing?.card ? m.family_billing_replace_your_card() : m.family_billing_add_card()}
			submitLabel={m.family_billing_save_card()}
			notice={cardNotice}
			onconfirmed={() => setupConfirmed(opened)}
			oncancel={() => (setup = null)}
		/>
	{/key}
{/if}
