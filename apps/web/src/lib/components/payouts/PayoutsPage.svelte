<script lang="ts">
	/** Helper payout account (piece 2b). Stripe hosts onboarding and the payout
	 * dashboard; this page shows the status Poppynz last fetched and sends the
	 * helper to Stripe. Nothing here blocks accepting contracts. */
	import {
		getPayouts,
		openPayoutsDashboard,
		refreshPayouts,
		startPayoutsOnboarding,
		type PayoutsDashboardError,
		type PayoutsOnboardingError,
		type PayoutsRefreshError,
		type PayoutsState,
		type PayoutsStatusError
	} from '$lib/api/payouts';
	import { m } from '$lib/paraglide/messages';
	import { payoutsBadge } from '$lib/payouts-badge.svelte';
	import { toast } from '$lib/toast.svelte';
	import { onMount } from 'svelte';

	interface Props {
		/** `stripe`: back from Stripe's hosted pages; `refresh`: the onboarding link expired. */
		returnState?: 'stripe' | 'refresh' | null;
		/** Called once the return is handled, so the route can drop the query. */
		onreturnhandled?: () => void;
		/** Leaves the app for a Stripe-hosted page. Injected in tests. */
		navigate?: (url: string) => void;
	}

	let {
		returnState = null,
		onreturnhandled,
		navigate = (url: string) => window.location.assign(url)
	}: Props = $props();

	let payouts = $state<PayoutsState | null>(null);
	let loading = $state(true);
	let busy = $state(false);

	type PayoutsError =
		| PayoutsStatusError
		| PayoutsOnboardingError
		| PayoutsRefreshError
		| PayoutsDashboardError;

	/** Localized text for a payouts failure (the API's messages are English). */
	function errorText(error: PayoutsError): string {
		switch (error.code) {
			case 'NO_PAYOUT_ACCOUNT':
				return m.payouts_error_no_account();
			case 'PAYOUTS_PROVIDER_ERROR':
				return m.payouts_error_provider();
			case 'PAYOUTS_LOOKUP_FAILED':
				return m.payouts_error_lookup();
			case 'UNEXPECTED':
				return error.status === null ? m.common_error_network() : m.common_error_generic();
			default:
				return m.common_error_generic();
		}
	}

	async function load(request: typeof getPayouts | typeof refreshPayouts) {
		loading = true;
		const result = await request();
		loading = false;
		if (result.ok) {
			payouts = result.data;
			payoutsBadge.needsSetup = !result.data.paymentReady;
		} else {
			toast.error(errorText(result.error), { title: m.payouts_unavailable_title() });
		}
	}

	/** Returns true when the browser is leaving for Stripe. */
	async function goToStripe(
		request: typeof startPayoutsOnboarding | typeof openPayoutsDashboard,
		failureTitle: string
	): Promise<boolean> {
		if (busy) return false;
		busy = true;
		const result = await request();
		if (result.ok) {
			// Stay busy: the page is being replaced by Stripe's.
			navigate(result.data.url);
			return true;
		}
		busy = false;
		toast.error(errorText(result.error), { title: failureTitle });
		return false;
	}

	onMount(() => {
		void (async () => {
			if (returnState === 'refresh') {
				onreturnhandled?.();
				const leaving = await goToStripe(startPayoutsOnboarding, m.payouts_reopen_failed_title());
				if (!leaving) await load(getPayouts);
				return;
			}
			if (returnState === 'stripe') {
				onreturnhandled?.();
				await load(refreshPayouts);
				return;
			}
			await load(getPayouts);
		})();
	});
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.payouts_title()}</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{m.payouts_intro()}
	</p>

	<section class="rounded-xl border border-card-border bg-base-100 p-5 lg:p-6" aria-live="polite">
		{#if loading}
			<span class="loading loading-spinner loading-md" aria-label={m.common_loading()}></span>
		{:else if payouts === null}
			<p class="text-sm text-base-content-muted">
				{m.payouts_load_failed()}
			</p>
		{:else if !payouts.hasAccount}
			<h2 class="text-[15px] font-bold text-base-content">
				{m.payouts_setup_title()}
			</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.payouts_setup_body()}
			</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, m.payouts_open_failed_title())}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				{m.payouts_setup_cta()}
			</button>
		{:else if payouts.status === 'ready'}
			<div class="flex items-center gap-2 text-success">
				<i class="las la-check-circle text-xl" aria-hidden="true"></i>
				<h2 class="text-[15px] font-bold">{m.payouts_ready_title()}</h2>
			</div>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.payouts_ready_body()}
			</p>
			<button
				type="button"
				class="btn mt-4 btn-outline"
				disabled={busy}
				onclick={() => goToStripe(openPayoutsDashboard, m.payouts_open_failed_title())}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				{m.payouts_view_in_stripe()}
			</button>
		{:else if payouts.status === 'restricted' && payouts.requirementsDue.length === 0}
			<!-- Restricted with nothing due: Stripe is verifying what it has
			     (pending_verification, under_review). Nothing for the helper to fix. -->
			<h2 class="text-[15px] font-bold text-base-content">
				{m.payouts_reviewing_title()}
			</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.payouts_reviewing_body()}
			</p>
		{:else if payouts.status === 'restricted'}
			<h2 class="text-[15px] font-bold text-base-content">
				{m.payouts_details_needed_title()}
			</h2>
			<ul class="mt-2 list-disc pl-5 text-sm text-base-content">
				{#each payouts.requirementsDue as label (label)}
					<li>{label}</li>
				{/each}
			</ul>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, m.payouts_open_failed_title())}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				{m.payouts_fix_in_stripe()}
			</button>
		{:else if payouts.status === 'disabled'}
			<h2 class="text-[15px] font-bold text-error">{m.payouts_disabled_title()}</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.payouts_disabled_body()}
			</p>
		{:else}
			<h2 class="text-[15px] font-bold text-base-content">
				{m.payouts_unfinished_title()}
			</h2>
			<p class="mt-1 text-sm text-base-content-muted">{m.payouts_unfinished_body()}</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, m.payouts_open_failed_title())}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				{m.payouts_continue_setup()}
			</button>
		{/if}
	</section>
</div>
