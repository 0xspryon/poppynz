<script lang="ts">
	import { formatCalendarDate } from '$lib/date';
	/** Where an applicant's safety check stands, plus the Credibled check list
	 * they pay for in one go. Data-in: the caller loads the summary and
	 * refetches through `onchanged`. "Documents" links either navigate
	 * (`documentsHref`) or run `ondocuments` when the checklist sits on the
	 * same page. */
	import type { ResolvedPathname } from '$app/types';
	import { untrack } from 'svelte';
	import {
		confirmSafetyCheckPayment,
		orderSafetyCheck,
		removeSafetyVerificationItem,
		type PaymentRequired,
		type SafetyVerificationState
	} from '$lib/api/safety-verification';
	import PaymentModal from '$lib/components/payments/PaymentModal.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { safetyVerificationErrorText } from './error-messages';

	interface Props {
		summary: SafetyVerificationState;
		onchanged: () => Promise<void>;
		documentsHref?: ResolvedPathname;
		ondocuments?: () => void;
		/** Label of the lone "go upload it" button when nothing can be ordered. */
		documentsLabel?: string;
		/** Where the documents checklist lives, for the status help text. */
		documentsPlace?: string;
		/** The lone "go upload it" button; off when the upload row is in view. */
		showDocumentsButton?: boolean;
	}

	// NB: not named `state` — that shadows the $state rune.
	let {
		summary,
		onchanged,
		documentsHref,
		ondocuments,
		documentsLabel = m.verify_documents_label_default(),
		documentsPlace = m.verify_documents_place_default(),
		showDocumentsButton = true
	}: Props = $props();

	const RETRY_MESSAGE = m.verify_error_retry();

	let ordering = $state(false);
	let removingId = $state<string | null>(null);

	/** The payment the modal is confirming (Stripe only — the mock settles at once). */
	let payment = $state<PaymentRequired | null>(null);

	const SAVE_NOTICE = m.verify_save_card_notice();

	const basket = $derived(summary.basket);

	async function removeItem(itemId: string) {
		if (removingId) return;
		removingId = itemId;
		const result = await removeSafetyVerificationItem(itemId);
		if (result.ok) {
			await onchanged();
		} else {
			toast.error(RETRY_MESSAGE, { title: m.verify_toast_not_removed_title() });
		}
		removingId = null;
	}

	/** Reached only once a check has actually started, never by reverting
	 * after a decline/abandonment (that lands back on `not_started`). Used to
	 * recognize a payment that settled while its modal was still open. */
	const SETTLED_STATUSES = new Set<SafetyVerificationState['verification']['status']>([
		'invited',
		'in_progress',
		'review_required',
		'verified'
	]);

	// A webhook, another tab, or the recovery job can settle the payment
	// while this modal is open; the realtime refresh (wired up by the page)
	// updates `summary` out from under it. Close it the same way a browser
	// confirm would, rather than leave a stale "Pay $X" button that only
	// gets Stripe's "already succeeded" error.
	$effect(() => {
		if (!SETTLED_STATUSES.has(summary.verification.status)) return;
		const current = untrack(() => payment);
		if (!current) return;
		payment = null;
		toast.success(m.verify_toast_payment_received());
	});

	const status = $derived(summary.verification.status);
	const canStart = $derived(status === 'not_started');
	// The Credibled card only earns its place when there is something to
	// order: a family's gate is upload-only, so they see the documents link
	// alone rather than an empty check list.
	const showCredibled = $derived(
		(canStart && summary.orderableCheckTypes.length > 0) || basket.length > 0
	);

	const chip: Record<string, ChipStatus> = {
		not_started: 'missing',
		payment_pending: 'in-progress',
		invited: 'in-progress',
		in_progress: 'in-progress',
		review_required: 'submitted',
		verified: 'approved',
		rejected: 'rejected',
		expired: 'expired'
	};

	/** Deliberately never says "verified" for a submitted document. */
	const statusLabel: Record<string, string> = {
		not_started: m.verify_status_not_started(),
		payment_pending: m.verify_status_payment_pending(),
		invited: m.verify_status_invited(),
		in_progress: m.verify_status_in_progress(),
		review_required: m.verify_status_review_required(),
		verified: m.verify_status_verified(),
		rejected: m.verify_status_rejected(),
		expired: m.verify_status_expired()
	};

	const statusHelp: Record<string, string> = $derived({
		// UAT #15: once something is on the list, stop asking to add documents.
		not_started:
			basket.length > 0
				? m.verify_help_list_ready()
				: summary.orderableCheckTypes.length > 0
					? m.verify_help_add_documents({ place: documentsPlace })
					: m.verify_help_upload_document({ place: documentsPlace }),
		payment_pending: m.verify_help_payment_pending(),
		invited: m.verify_help_invited(),
		in_progress: m.verify_help_in_progress(),
		review_required: m.verify_help_review_required(),
		verified: m.verify_help_verified(),
		rejected: m.verify_help_rejected(),
		expired: m.verify_help_expired()
	});

	/** One row per tax label ("HST (ON) 13%"): the checks and the admin fee are
	 * separate supplies taxed alike, shown as one line. */
	const taxByLabel = (lines: ReadonlyArray<{ label: string; taxCents: number }>) => {
		const rows: Array<{ label: string; taxCents: number }> = [];
		for (const line of lines) {
			const row = rows.find((existing) => existing.label === line.label);
			if (row) row.taxCents += line.taxCents;
			else rows.push({ label: line.label, taxCents: line.taxCents });
		}
		return rows;
	};

	/** Starts the payment — or resumes the one already started. */
	async function order() {
		if (ordering) return;
		ordering = true;
		const result = await orderSafetyCheck();
		if (result.ok) {
			if (result.data.status === 'paid') {
				toast.success(m.verify_toast_payment_received());
				await onchanged();
			} else {
				payment = result.data;
				// The mock has no card form: there is nothing for the payer to do.
				if (result.data.provider === 'mock') await paymentConfirmed();
			}
		} else {
			toast.error(
				result.error.code === 'SAFETY_VERIFICATION_UNAVAILABLE'
					? m.verify_toast_ordering_unavailable()
					: result.error.code === 'SAFETY_VERIFICATION_PAYMENT_FAILED' ||
						  result.error.code === 'SAFETY_VERIFICATION_CONFLICT' ||
						  result.error.code === 'TAX_PROVINCE_REQUIRED' ||
						  result.error.code === 'TAX_CONFIGURATION_INCOMPLETE'
						? safetyVerificationErrorText(result.error)
						: RETRY_MESSAGE,
				{ title: m.verify_toast_not_ordered_title() }
			);
		}
		ordering = false;
	}

	/** Stripe confirmed in the browser; the server decides from Stripe's own
	 * record whether the money moved. */
	async function paymentConfirmed() {
		const current = payment;
		if (!current) return;
		const result = await confirmSafetyCheckPayment(current.paymentId);
		payment = null;
		if (!result.ok) {
			toast.error(RETRY_MESSAGE, { title: m.verify_toast_payment_not_confirmed_title() });
		} else if (result.data.status === 'paid') {
			toast.success(m.verify_toast_payment_received());
		} else if (result.data.status === 'failed') {
			// The server's reason is the provider's own (English) wording, or an
			// internal note — the payment modal already showed the card's reason.
			toast.error(m.verify_toast_payment_declined(), {
				title: m.verify_toast_payment_declined_title()
			});
		} else {
			toast.info(m.verify_toast_payment_confirming());
		}
		await onchanged();
	}

	/** Stripe refused the card, or — when `alreadySettled` — the intent had
	 * already settled elsewhere (a webhook, another tab, the recovery job)
	 * while this modal sat open. For a real decline, the server releases the
	 * order so the basket can be paid again and the modal keeps Stripe's
	 * reason on screen. For an already-settled intent, ask the server the
	 * same way the browser's own confirm would — it is still the only source
	 * of truth for whether the money moved. */
	function paymentFailed(info?: { alreadySettled: boolean }) {
		const current = payment;
		if (!current) return;
		if (info?.alreadySettled) {
			void paymentConfirmed();
			return;
		}
		void confirmSafetyCheckPayment(current.paymentId).then(() => onchanged());
	}
</script>

{#snippet documentsLink(classes: string, label: string)}
	{#if documentsHref}
		<a class={classes} href={documentsHref}>{label}</a>
	{:else if ondocuments}
		<button type="button" class={classes} onclick={ondocuments}>{label}</button>
	{/if}
{/snippet}

<div class="rounded-xl border border-card-border bg-base-100 p-5">
	<div class="flex flex-wrap items-center gap-3">
		<span class="text-sm font-semibold text-base-content">{m.verify_your_status()}</span>
		<StatusChip status={chip[status] ?? 'missing'} label={statusLabel[status]} />
		{#if summary.verification.expiresOn && status === 'verified'}
			<span class="text-xs text-base-content-muted">
				{m.verify_valid_until({ date: formatCalendarDate(summary.verification.expiresOn) })}
			</span>
		{/if}
	</div>
	<p class="mt-2 text-sm text-base-content-muted">{statusHelp[status]}</p>
	{#if status === 'not_started' && !showCredibled && showDocumentsButton}
		{@render documentsLink('btn btn-primary btn-sm mt-3', documentsLabel)}
	{/if}

	{#if summary.canResumePayment}
		<button type="button" class="btn btn-primary btn-sm mt-3" disabled={ordering} onclick={order}>
			{#if ordering}<span class="loading loading-spinner loading-xs"></span>{/if}
			{m.verify_continue_payment()}
		</button>
	{/if}

	{#if summary.verification.applicationUrl}
		<a
			class="btn btn-primary btn-sm mt-3"
			href={summary.verification.applicationUrl}
			target="_blank"
			rel="external noopener noreferrer"
		>
			{m.verify_continue_check()}
		</a>
	{/if}

	{#if summary.verification.decisionReason}
		<p
			class="mt-3 max-w-xl rounded-md border border-error-content bg-error-content/40 px-3 py-2
				text-xs leading-relaxed text-error"
		>
			<b>{m.verify_reason_label()}</b>
			{summary.verification.decisionReason}
		</p>
	{/if}
</div>

{#if showCredibled}
	<h2 class="mt-8 mb-3 text-lg font-semibold text-base-content">
		{canStart ? m.verify_order_checks_heading() : m.verify_collecting_heading()}
	</h2>

	<div class="grid gap-4">
		<div class="rounded-xl border border-credibled-border bg-credibled-card p-5">
			<span
				class="rounded-pill bg-credibled-tint px-2 py-0.5 text-[10.5px] font-semibold
					text-credibled-text"
			>
				{m.verify_powered_by_credibled()}
			</span>
			<h3 class="mt-3 text-base font-semibold text-base-content">
				{m.verify_check_list_heading()}
			</h3>

			{#if basket.length === 0}
				<p class="mt-1 text-sm text-base-content-muted">
					{m.verify_check_list_empty()}
				</p>
				{@render documentsLink('btn btn-outline btn-sm mt-4 w-full', m.verify_choose_documents())}
			{:else}
				<p class="mt-1 text-sm text-base-content-muted">
					{canStart ? m.verify_check_list_intro_unpaid() : m.verify_check_list_intro_paid()}
				</p>

				<ul class="mt-4 flex flex-col gap-2">
					{#each basket as item (item.id)}
						<li class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="text-sm font-medium text-base-content">{item.name}</p>
								<!-- UAT #15: the check's name was printed twice. -->
								{#if item.credibledLabel.trim().toLowerCase() !== item.name.trim().toLowerCase()}
									<p class="text-xs text-base-content-muted">{item.credibledLabel}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<span class="text-sm tabular-nums text-base-content">
									{formatMoney(item.costCents)}
								</span>
								<!-- Removable only while the list is still unpaid. -->
								{#if canStart}
									<button
										type="button"
										class="btn btn-ghost btn-xs btn-square"
										aria-label={m.verify_remove_item({ name: item.name })}
										disabled={removingId !== null}
										onclick={() => removeItem(item.id)}
									>
										<i class="las la-times text-sm" aria-hidden="true"></i>
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>

				{#if canStart && summary.quote === null}
					<!-- No quote: sales tax depends on the payer's province, and an
					     unknown one is never priced at 0. -->
					<p class="mt-4 border-t border-credibled-border pt-3 text-sm text-base-content-muted">
						{summary.quoteBlockedReason === 'tax_province_required'
							? m.verify_quote_province_required()
							: m.verify_quote_unavailable()}
					</p>
				{:else if canStart && summary.quote}
					<dl class="mt-4 space-y-1 border-t border-credibled-border pt-3 text-sm">
						<div class="flex justify-between">
							<dt class="text-base-content-muted">{m.verify_quote_checks()}</dt>
							<dd class="tabular-nums text-base-content">
								{formatMoney(summary.quote.amountCents)}
							</dd>
						</div>
						<div class="flex justify-between">
							<dt class="text-base-content-muted">{m.verify_quote_admin_fee()}</dt>
							<dd class="tabular-nums text-base-content">{formatMoney(summary.quote.feeCents)}</dd>
						</div>
						{#each taxByLabel(summary.quote.taxLines) as line (line.label)}
							<div class="flex justify-between">
								<dt class="text-base-content-muted">{line.label}</dt>
								<dd class="tabular-nums text-base-content">{formatMoney(line.taxCents)}</dd>
							</div>
						{/each}
						<div class="flex justify-between pt-1 font-semibold">
							<dt class="text-base-content">{m.verify_quote_total()}</dt>
							<dd class="tabular-nums text-base-content">
								{formatMoney(summary.quote.totalCents)}
							</dd>
						</div>
					</dl>

					<button
						type="button"
						class="btn btn-primary btn-sm mt-4 w-full"
						disabled={!summary.canOrderThroughCredibled || ordering}
						onclick={order}
					>
						{#if ordering}<span class="loading loading-spinner loading-xs"></span>{/if}
						{m.verify_pay_and_start({ amount: formatMoney(summary.quote.totalCents) })}
					</button>
					{@render documentsLink(
						'btn btn-ghost btn-xs mt-2 w-full',
						m.verify_add_another_document()
					)}
				{:else if summary.verification.cost}
					<!-- What was actually charged, frozen at payment — never the
					     live quote, which today's prices would recompute. -->
					<dl class="mt-4 space-y-1 border-t border-credibled-border pt-3 text-sm">
						<div class="flex justify-between font-semibold">
							<dt class="text-base-content">{m.verify_paid()}</dt>
							<dd class="tabular-nums text-base-content">
								{formatMoney(summary.verification.cost.totalCents)}
							</dd>
						</div>
					</dl>
				{/if}
			{/if}
		</div>
	</div>
{/if}

{#if payment}
	<PaymentModal
		mode="payment"
		clientSecret={payment.clientSecret}
		title={m.verify_payment_modal_title()}
		submitLabel={m.verify_pay_amount({ amount: formatMoney(payment.totalCents) })}
		savedCard={payment.savedCard}
		notice={payment.savesCard ? SAVE_NOTICE : null}
		onconfirmed={paymentConfirmed}
		onfailed={paymentFailed}
		oncancel={() => {
			payment = null;
			void onchanged();
		}}
	/>
{/if}
