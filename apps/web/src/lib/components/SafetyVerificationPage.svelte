<script lang="ts">
	/** Shared safety-verification screen for both roles (families and helpers
	 * are screened identically — only the copy differs). Offers the two routes
	 * to being verified and shows where the current one stands. */
	import { onMount } from 'svelte';
	import {
		getSafetyVerification,
		orderSafetyCheck,
		removeSafetyVerificationItem,
		type SafetyVerificationState
	} from '$lib/api/safety-verification';
	import { resolve } from '$app/paths';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	// NB: not named `state` — that shadows the $state rune and svelte-check
	// resolves the rune to the local binding.
	let page = $state<SafetyVerificationState | null>(null);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	let ordering = $state(false);
	let removingId = $state<string | null>(null);

	const basket = $derived(page?.basket ?? []);
	const documentsHref = $derived(
		role === 'family' ? resolve('/family/profile') : resolve('/service-provider/documents')
	);

	async function removeItem(itemId: string) {
		if (removingId) return;
		removingId = itemId;
		const result = await removeSafetyVerificationItem(itemId);
		if (result.ok) {
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Not removed' });
		}
		removingId = null;
	}


	const status = $derived(page?.verification.status ?? 'not_started');
	const canStart = $derived(status === 'not_started');

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
		not_started: 'Not started',
		payment_pending: 'Payment in progress',
		invited: 'Waiting on you',
		in_progress: 'In progress',
		review_required: 'Submitted for review',
		verified: 'Verified',
		rejected: 'Not approved',
		expired: 'Expired'
	};

	const statusHelp: Record<string, string> = {
		not_started:
			'Add documents from your Documents page, then pay for them together here.',
		payment_pending: 'We are confirming your payment. This usually takes a moment.',
		invited:
			'We emailed you a secure link to finish your check — you can also continue below.',
		in_progress: 'Your check is being processed. We will let you know when it is done.',
		review_required:
			'A Poppynz administrator is reviewing your submission. Submitted is not the same as verified — we will confirm once the review is complete.',
		verified: 'You are verified and can use Poppynz normally.',
		rejected: 'Your verification was not approved.',
		expired: 'Your verification has lapsed. Renew it to keep using Poppynz.'
	};

	const money = (cents: number) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);

	async function load() {
		loading = true;
		const result = await getSafetyVerification();
		if (result.ok) {
			page = result.data;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'UNAUTHORIZED'
					? 'Your session has expired — sign in again.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	async function order() {
		if (ordering) return;
		ordering = true;
		const result = await orderSafetyCheck();
		if (result.ok) {
			toast.success('Payment received. We are setting up your check now.');
			await load();
		} else {
			toast.error(
				result.error.code === 'SAFETY_VERIFICATION_UNAVAILABLE'
					? 'Ordering is temporarily unavailable. Please try again shortly.'
					: RETRY_MESSAGE,
				{ title: 'Check not ordered' }
			);
		}
		ordering = false;
	}

</script>

<svelte:head>
	<title>Safety verification · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Safety verification</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{role === 'family'
			? 'Every Poppynz family completes a safety check before booking.'
			: 'Every Poppynz helper completes a safety check before taking bookings.'}
	</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if page}
		<div class="rounded-xl border border-card-border bg-base-100 p-5">
			<div class="flex flex-wrap items-center gap-3">
				<span class="text-sm font-semibold text-base-content">Your status</span>
				<StatusChip status={chip[status] ?? 'missing'} label={statusLabel[status]} />
				{#if page.verification.expiresOn && status === 'verified'}
					<span class="text-xs text-base-content-muted">
						Valid until {page.verification.expiresOn}
					</span>
				{/if}
			</div>
			<p class="mt-2 text-sm text-base-content-muted">{statusHelp[status]}</p>

			{#if page.verification.applicationUrl}
				<a
					class="btn btn-primary btn-sm mt-3"
					href={page.verification.applicationUrl}
					target="_blank"
					rel="noopener noreferrer"
				>
					Continue your check
				</a>
			{/if}

			{#if page.verification.decisionReason}
				<p
					class="mt-3 max-w-xl rounded-md border border-error-content bg-error-content/40 px-3 py-2
						text-xs leading-relaxed text-error"
				>
					<b>Reason:</b>
					{page.verification.decisionReason}
				</p>
			{/if}
		</div>

		{#if canStart || basket.length > 0}
			<h2 class="mt-8 mb-3 text-lg font-semibold text-base-content">
				{canStart ? 'Order checks' : 'Checks Credibled is collecting'}
			</h2>

			<div class="grid gap-4">
				<div class="rounded-xl border border-credibled-border bg-credibled-card p-5">
					<span
						class="rounded-pill bg-credibled-tint px-2 py-0.5 text-[10.5px] font-semibold
							text-credibled-text"
					>
						Powered by Credibled
					</span>
					<h3 class="mt-3 text-base font-semibold text-base-content">Your check list</h3>

					{#if basket.length === 0}
						<p class="mt-1 text-sm text-base-content-muted">
							Nothing selected yet. Pick the documents you'd like Credibled to collect, then come
							back here to pay for them together.
						</p>
						<a class="btn btn-outline btn-sm mt-4 w-full" href={documentsHref}>
							Choose documents
						</a>
					{:else}
						<p class="mt-1 text-sm text-base-content-muted">
							{canStart
								? 'You complete these securely with our screening provider — Poppynz never sees your ID documents.'
								: 'These are being collected by our screening provider. You complete them securely with Credibled — Poppynz never sees your ID documents.'}
						</p>

						<ul class="mt-4 flex flex-col gap-2">
							{#each basket as item (item.id)}
								<li class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="text-sm font-medium text-base-content">{item.name}</p>
										<p class="text-xs text-base-content-muted">{item.credibledLabel}</p>
									</div>
									<div class="flex shrink-0 items-center gap-2">
										<span class="text-sm tabular-nums text-base-content">
											{money(item.costCents)}
										</span>
										<!-- Removable only while the list is still unpaid. -->
										{#if canStart}
											<button
												type="button"
												class="btn btn-ghost btn-xs btn-square"
												aria-label="Remove {item.name}"
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

						{#if canStart}
							<dl class="mt-4 space-y-1 border-t border-credibled-border pt-3 text-sm">
								<div class="flex justify-between">
									<dt class="text-base-content-muted">Checks</dt>
									<dd class="tabular-nums text-base-content">{money(page.quote.amountCents)}</dd>
								</div>
								<div class="flex justify-between">
									<dt class="text-base-content-muted">Poppynz administration fee</dt>
									<dd class="tabular-nums text-base-content">{money(page.quote.feeCents)}</dd>
								</div>
								<div class="flex justify-between">
									<dt class="text-base-content-muted">Tax</dt>
									<dd class="tabular-nums text-base-content">{money(page.quote.taxCents)}</dd>
								</div>
								<div class="flex justify-between pt-1 font-semibold">
									<dt class="text-base-content">Total</dt>
									<dd class="tabular-nums text-base-content">{money(page.quote.totalCents)}</dd>
								</div>
							</dl>

							<button
								type="button"
								class="btn btn-primary btn-sm mt-4 w-full"
								disabled={!page.canOrderThroughCredibled || ordering}
								onclick={order}
							>
								{#if ordering}<span class="loading loading-spinner loading-xs"></span>{/if}
								Pay {money(page.quote.totalCents)} and start
							</button>
							<a class="btn btn-ghost btn-xs mt-2 w-full" href={documentsHref}>
								Add another document
							</a>
						{:else if page.verification.cost}
							<!-- What was actually charged, frozen at payment — never the
							     live quote, which today's prices would recompute. -->
							<dl class="mt-4 space-y-1 border-t border-credibled-border pt-3 text-sm">
								<div class="flex justify-between font-semibold">
									<dt class="text-base-content">Paid</dt>
									<dd class="tabular-nums text-base-content">
										{money(page.verification.cost.totalCents)}
									</dd>
								</div>
							</dl>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
