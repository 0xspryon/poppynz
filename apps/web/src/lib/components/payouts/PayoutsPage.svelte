<script lang="ts">
	/** Helper payout account (piece 2b). Stripe hosts onboarding and the payout
	 * dashboard; this page shows the status Poppynz last fetched and sends the
	 * helper to Stripe. Nothing here blocks accepting contracts. */
	import {
		getPayouts,
		openPayoutsDashboard,
		refreshPayouts,
		startPayoutsOnboarding,
		type PayoutsState
	} from '$lib/api/payouts';
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

	async function load(request: typeof getPayouts | typeof refreshPayouts) {
		loading = true;
		const result = await request();
		loading = false;
		if (result.ok) {
			payouts = result.data;
			payoutsBadge.needsSetup = !result.data.paymentReady;
		} else {
			toast.error(result.error.message, { title: 'Payouts unavailable' });
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
		toast.error(result.error.message, { title: failureTitle });
		return false;
	}

	onMount(() => {
		void (async () => {
			if (returnState === 'refresh') {
				onreturnhandled?.();
				const leaving = await goToStripe(startPayoutsOnboarding, "Couldn't reopen Stripe");
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
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Payouts</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Poppynz pays your earnings through Stripe. Stripe verifies your identity and your bank
		account — Poppynz never sees those details.
	</p>

	<section class="rounded-xl border border-card-border bg-base-100 p-5 lg:p-6" aria-live="polite">
		{#if loading}
			<span class="loading loading-spinner loading-md" aria-label="Loading"></span>
		{:else if payouts === null}
			<p class="text-sm text-base-content-muted">
				Your payout status couldn't be loaded. Refresh the page to try again.
			</p>
		{:else if !payouts.hasAccount}
			<h2 class="text-[15px] font-bold text-base-content">Set up your payout account</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				It takes a few minutes on Stripe. You can accept contracts before it's done, but you'll
				need it to be paid.
			</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Set up payouts
			</button>
		{:else if payouts.status === 'ready'}
			<div class="flex items-center gap-2 text-success">
				<i class="las la-check-circle text-xl" aria-hidden="true"></i>
				<h2 class="text-[15px] font-bold">Ready to be paid</h2>
			</div>
			<p class="mt-1 text-sm text-base-content-muted">
				Your payout account is set up. Stripe sends your earnings to your bank account.
			</p>
			<button
				type="button"
				class="btn mt-4 btn-outline"
				disabled={busy}
				onclick={() => goToStripe(openPayoutsDashboard, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				View payouts in Stripe
			</button>
		{:else if payouts.status === 'restricted' && payouts.requirementsDue.length === 0}
			<!-- Restricted with nothing due: Stripe is verifying what it has
			     (pending_verification, under_review). Nothing for the helper to fix. -->
			<h2 class="text-[15px] font-bold text-base-content">Stripe is reviewing your details</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				There's nothing more to do for now. This page updates once Stripe has finished.
			</p>
		{:else if payouts.status === 'restricted'}
			<h2 class="text-[15px] font-bold text-base-content">Stripe needs a few more details</h2>
			<ul class="mt-2 list-disc pl-5 text-sm text-base-content">
				{#each payouts.requirementsDue as label (label)}
					<li>{label}</li>
				{/each}
			</ul>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Fix in Stripe
			</button>
		{:else if payouts.status === 'disabled'}
			<h2 class="text-[15px] font-bold text-error">Payouts are turned off</h2>
			<p class="mt-1 text-sm text-base-content-muted">
				Stripe can't pay out to this account. Please contact Poppynz support so we can help you
				sort it out.
			</p>
		{:else}
			<h2 class="text-[15px] font-bold text-base-content">Your setup isn't finished</h2>
			<p class="mt-1 text-sm text-base-content-muted">Pick up where you left off on Stripe.</p>
			<button
				type="button"
				class="btn mt-4 btn-primary"
				disabled={busy}
				onclick={() => goToStripe(startPayoutsOnboarding, "Couldn't open Stripe")}
			>
				{#if busy}<span class="loading loading-spinner loading-xs"></span>{/if}
				Continue setup
			</button>
		{/if}
	</section>
</div>
