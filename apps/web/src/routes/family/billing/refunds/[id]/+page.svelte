<script lang="ts">
	/** A session refund's receipt — the credit note (Tier 3 step 2): its
	 * number and dates, the charge it reverses, the care, the service fee and
	 * each tax returned (with the registration number it was collected
	 * under), the total and the helper. Printable on its own. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getRefundReceipt, type RefundReceipt } from '$lib/api/session-money';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDate, formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { intlLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';
	import { refundStatusChip } from '$lib/session-money';
	import { localizeTaxLabel } from '$lib/tax-label';

	const id = $derived(page.params.id ?? '');

	let receipt = $state<RefundReceipt | null>(null);
	let loading = $state(true);
	let loadState = $state<'ok' | 'error' | 'not_found'>('ok');

	let seq = 0;
	async function load(refundId: string) {
		seq += 1;
		const mine = seq;
		loading = true;
		const result = await getRefundReceipt(refundId);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			receipt = result.data.receipt;
			loadState = 'ok';
		} else {
			receipt = null;
			loadState =
				result.error.code === 'REFUND_NOT_FOUND' || result.error.code === 'INVALID_REFUND_ID'
					? 'not_found'
					: 'error';
		}
	}

	$effect(() => {
		if (id) void load(id);
	});

	const money = (cents: number, currency: string) =>
		new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(cents / 100);
	const status = $derived(receipt ? refundStatusChip(receipt.status) : null);
</script>

<svelte:head>
	<title>
		{receipt
			? m.refunds_receipt_page_title({ number: receipt.number })
			: m.refunds_receipt_page_title_loading()}
	</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
		<a
			href={resolve('/family/billing')}
			class="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
		>
			<i class="las la-angle-left" aria-hidden="true"></i>
			{m.refunds_receipt_back()}
		</a>
		{#if receipt}
			<button type="button" class="btn btn-outline btn-sm" onclick={() => window.print()}>
				<i class="las la-print" aria-hidden="true"></i>
				{m.refunds_receipt_print()}
			</button>
		{/if}
	</div>

	{#if loading && !receipt}
		<div class="flex justify-center py-24">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if !receipt}
		<p class="text-sm font-medium text-error" role="alert">
			{loadState === 'not_found' ? m.refunds_receipt_not_found() : m.refunds_receipt_load_error()}
		</p>
	{:else}
		<article
			class="refund-receipt rounded-xl border border-card-border bg-base-100 p-6 lg:p-8"
			data-testid="refund-receipt"
		>
			<header
				class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-4"
			>
				<div>
					<p class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">Poppynz</p>
					<h1 class="font-display text-xl font-bold text-base-content lg:text-2xl">
						{m.refunds_receipt_title()}
					</h1>
					<p class="text-sm text-base-content-muted">
						{m.refunds_receipt_number({ number: receipt.number })}
					</p>
				</div>
				<div class="text-right text-[12.5px] text-base-content-muted">
					<p>{m.refunds_receipt_issued({ date: formatDate(receipt.createdAt) })}</p>
					{#if receipt.refundedAt}
						<p>{m.refunds_receipt_refunded({ date: formatDate(receipt.refundedAt) })}</p>
					{/if}
					{#if status}
						<p class="font-semibold text-base-content">
							{m.refunds_receipt_status({ status: status.label })}
						</p>
					{/if}
				</div>
			</header>

			<section class="border-b border-base-300 py-4 text-[13px]">
				<h2 class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
					{m.refunds_receipt_for()}
				</h2>
				{#if receipt.session}
					<p class="text-base-content">
						{m.refunds_receipt_session({
							service: receipt.session.serviceName,
							date: formatDateWithWeekday(receipt.session.date),
							time: formatSessionRange({
								weekday: 0,
								startMinutes: receipt.session.startMinutes,
								endMinutes: receipt.session.endMinutes
							})
						})}
					</p>
				{/if}
				{#if receipt.helperName}
					<p class="text-base-content-muted">
						{m.refunds_receipt_helper({ name: receipt.helperName })}
					</p>
				{/if}
				<p class="mt-1 text-base-content-muted">
					{m.refunds_receipt_charge({
						description: receipt.charge.description ?? '—',
						date: formatDateTime(receipt.charge.chargedAt),
						amount: money(receipt.charge.totalCents, receipt.currency)
					})}
				</p>
			</section>

			<section class="py-4">
				<dl class="flex flex-col gap-1.5 text-[13px]" data-testid="refund-receipt-lines">
					<div class="flex justify-between gap-3">
						<dt class="text-base-content-muted">{m.refunds_receipt_care()}</dt>
						<dd class="tabular-nums">{money(receipt.careCents, receipt.currency)}</dd>
					</div>
					{#if receipt.feeCents > 0}
						<div class="flex justify-between gap-3">
							<dt class="text-base-content-muted">{m.refunds_receipt_fee()}</dt>
							<dd class="tabular-nums">{money(receipt.feeCents, receipt.currency)}</dd>
						</div>
					{/if}
					{#each receipt.taxLines as line, index (`${line.label}-${index}`)}
						<div class="flex justify-between gap-3" data-testid="refund-receipt-tax">
							<dt class="text-base-content-muted">
								{m.refunds_receipt_tax_line({
									tax: localizeTaxLabel(line.label),
									base: money(line.baseCents, receipt.currency)
								})}
								{#if line.registrationNumber}
									<span class="block text-[11px] text-outline">
										{m.refunds_receipt_registration({ number: line.registrationNumber })}
									</span>
								{/if}
							</dt>
							<dd class="tabular-nums">{money(line.taxCents, receipt.currency)}</dd>
						</div>
					{/each}
					<div
						class="mt-1 flex justify-between gap-3 border-t border-base-300 pt-1.5 font-semibold"
					>
						<dt class="text-base-content">{m.refunds_receipt_total()}</dt>
						<dd class="tabular-nums text-secondary">
							{money(receipt.totalCents, receipt.currency)}
						</dd>
					</div>
				</dl>
			</section>

			<p class="text-[11px] leading-relaxed text-outline">{m.refunds_receipt_footer()}</p>
		</article>
	{/if}
</div>

<style>
	/* Print the credit note alone, without the app's navigation. */
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		:global(.refund-receipt),
		:global(.refund-receipt *) {
			visibility: visible;
		}
		:global(.refund-receipt) {
			position: absolute;
			inset: 0 0 auto 0;
			border: 0;
		}
	}
</style>
