<script lang="ts">
	/** A family's card on file and payment history. The card funds contract
	 * billing, so it can be replaced but not simply removed. Receipts are
	 * Stripe's; invoices and tax receipts wait for the accountant's sign-off. */
	import { onMount } from 'svelte';
	import {
		confirmCardSetup,
		getBilling,
		startCardSetup,
		type BillingData,
		type BillingPayment
	} from '$lib/api/billing';
	import PaymentModal from '$lib/components/payments/PaymentModal.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatDate } from '$lib/date';
	import { cardExpiry, cardLabel } from '$lib/payment-cards';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

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
	});

	async function addCard() {
		if (starting) return;
		starting = true;
		const result = await startCardSetup();
		starting = false;
		if (!result.ok) {
			toast.error(
				result.error.code === 'BILLING_PROVIDER_UNAVAILABLE' ? result.error.message : RETRY_MESSAGE,
				{ title: 'Card not added' }
			);
			return;
		}
		setup = { setupId: result.data.setupId, clientSecret: result.data.clientSecret };
		// The mock has no card form: its setup is already complete.
		if (result.data.provider === 'mock') await setupConfirmed();
	}

	async function setupConfirmed() {
		const current = setup;
		if (!current) return;
		const result = await confirmCardSetup(current.setupId);
		setup = null;
		if (result.ok) {
			toast.success(`${cardLabel(result.data.card)} is now your card on file.`, {
				title: 'Card saved'
			});
			await load();
		} else {
			toast.error(
				result.error.code === 'BILLING_CARD_SETUP_INCOMPLETE'
					? result.error.message
					: RETRY_MESSAGE,
				{ title: 'Card not saved' }
			);
		}
	}

	const chip: Record<BillingPayment['status'], { status: ChipStatus; label: string }> = {
		paid: { status: 'approved', label: 'Paid' },
		refunded: { status: 'expired', label: 'Refunded' },
		failed: { status: 'rejected', label: 'Failed' },
		pending: { status: 'in-progress', label: 'Pending' },
		on_hold: { status: 'in-progress', label: 'On hold' }
	};

	const money = (cents: number, currency: string) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
</script>

<svelte:head>
	<title>Billing · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Billing</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Your card on file and what you have paid through Poppynz.
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if loadFailed || !billing}
		<p role="alert" class="text-sm font-medium text-error">{RETRY_MESSAGE}</p>
	{:else}
		<section class="rounded-xl border border-card-border bg-base-100 p-5">
			<h2 class="text-base font-semibold text-base-content">Card on file</h2>
			{#if billing.card}
				<div class="mt-3 flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="text-sm font-medium text-base-content">{cardLabel(billing.card)}</p>
						<p class="text-xs text-base-content-muted">Expires {cardExpiry(billing.card)}</p>
					</div>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={starting}
						onclick={addCard}
					>
						{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
						Replace card
					</button>
				</div>
			{:else}
				<p class="mt-1 text-sm text-base-content-muted">
					No card yet. Your card is used for contract billing — you need one to send contract terms.
				</p>
				<button
					type="button"
					class="btn btn-primary btn-sm mt-3"
					disabled={starting}
					onclick={addCard}
				>
					{#if starting}<span class="loading loading-spinner loading-xs"></span>{/if}
					Add a card
				</button>
			{/if}
		</section>

		<h2 class="mt-8 mb-3 text-lg font-semibold text-base-content">Payment history</h2>
		{#if billing.payments.length === 0}
			<p class="text-sm text-base-content-muted">No payments yet.</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
				<table class="table">
					<thead>
						<tr>
							<th>Date</th>
							<th>Description</th>
							<th class="text-right">Amount</th>
							<th>Status</th>
							<th><span class="sr-only">Receipt</span></th>
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
											Incl. {row.taxLines
												.map((line) => `${line.label} ${money(line.taxCents, row.currency)}`)
												.join(' · ')}
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
											Receipt
										</a>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

{#if setup && billing?.provider !== 'mock'}
	<PaymentModal
		mode="setup"
		clientSecret={setup.clientSecret}
		title={billing?.card ? 'Replace your card' : 'Add a card'}
		submitLabel="Save card"
		notice="Your card is kept for Poppynz payments such as contract billing. Nothing is charged now."
		onconfirmed={setupConfirmed}
		oncancel={() => (setup = null)}
	/>
{/if}
