<script lang="ts">
	/** Stripe's Payment Element in a modal, for paying (`payment` mode, a
	 * PaymentIntent's client secret) or saving a card (`setup` mode, a
	 * SetupIntent's). Confirms with `redirect: 'if_required'` — cards only, so
	 * 3-D Secure opens over the modal instead of leaving the page. Stripe's own
	 * messages show here; whether money moved is decided by the server, which
	 * the caller asks through `onconfirmed` / `onfailed`. */
	import type { Stripe, StripeElements, StripeError } from '@stripe/stripe-js';
	import { getStripe } from '$lib/stripe';
	import { getUserLanguage, toStripeLocale } from '$lib/user-language';
	import { cardLabel } from '$lib/payment-cards';

	interface Props {
		mode: 'payment' | 'setup';
		clientSecret: string;
		title: string;
		/** e.g. "Pay $75.00" or "Save card". */
		submitLabel: string;
		/** Payment mode: the family's saved card, already attached to the intent —
		 * offered as one click, with "Use another card" for the form. */
		savedCard?: { brand: string; last4: string } | null;
		/** Shown above the card form, e.g. that a new card will be kept. */
		notice?: string | null;
		/** The billing country the card form starts on (ISO code). Poppynz
		 * bills in Canada, so never the visitor's IP country. */
		defaultCountry?: string;
		/** Stripe confirmed. The caller settles through its confirm endpoint and
		 * closes the modal. */
		onconfirmed: () => Promise<void>;
		/** Payment mode: Stripe refused the card, or — when `alreadySettled` —
		 * the intent is no longer payable because it settled elsewhere (a
		 * webhook, another tab, the recovery job) while this modal sat open.
		 * The caller settles (the server releases the order, or recognizes the
		 * existing success); the modal stays open to show why unless the
		 * caller closes it itself. */
		onfailed?: (info?: { alreadySettled: boolean }) => void;
		oncancel: () => void;
	}

	let {
		mode,
		clientSecret,
		title,
		submitLabel,
		savedCard = null,
		notice = null,
		defaultCountry = 'CA',
		onconfirmed,
		onfailed,
		oncancel
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	let useSavedCard = $state(savedCard !== null);
	// Raw, not deep state: Stripe's objects must not be wrapped in proxies.
	let stripe = $state.raw<Stripe | null>(null);
	let elements = $state.raw<StripeElements | null>(null);
	let elementHost = $state<HTMLDivElement | null>(null);
	let submitting = $state(false);
	let message = $state<string | null>(null);
	/** A refused payment cannot be retried on the same intent: only Close. */
	let finished = $state(false);

	// Load Stripe.js once; mount the Payment Element whenever the card form is
	// on screen.
	$effect(() => {
		if (useSavedCard || !elementHost || elements) return;
		const host = elementHost;
		void Promise.all([getStripe(), getUserLanguage()]).then(([loaded, language]) => {
			if (!loaded) {
				message = 'Card payments are not available right now.';
				return;
			}
			stripe = loaded;
			const group = loaded.elements({ clientSecret, locale: toStripeLocale(language) });
			group
				.create('payment', {
					layout: 'tabs',
					defaultValues: { billingDetails: { address: { country: defaultCountry } } }
				})
				.mount(host);
			elements = group;
		});
	});

	/** The intent is no longer payable because it already settled elsewhere
	 * (a webhook, another tab, the recovery job) while this modal sat open —
	 * not a declined card. */
	function isAlreadySettled(error: StripeError): boolean {
		return (
			error.code === 'payment_intent_unexpected_state' ||
			error.payment_intent?.status === 'succeeded'
		);
	}

	function handleError(error: StripeError) {
		// A card that was refused (not a typo in the form) ends this attempt.
		if (mode === 'payment' && error.type !== 'validation_error') {
			finished = true;
			if (isAlreadySettled(error)) {
				onfailed?.({ alreadySettled: true });
				return;
			}
			message = error.message ?? 'Your card could not be used.';
			onfailed?.();
			return;
		}
		message = error.message ?? 'Your card could not be used.';
	}

	async function submit() {
		if (submitting || finished) return;
		submitting = true;
		message = null;
		const loaded = stripe ?? (await getStripe());
		if (!loaded) {
			message = 'Card payments are not available right now.';
			submitting = false;
			return;
		}
		const result =
			mode === 'setup'
				? await loaded.confirmSetup({ elements: elements!, redirect: 'if_required' })
				: useSavedCard
					? await loaded.confirmPayment({ clientSecret, redirect: 'if_required' })
					: await loaded.confirmPayment({ elements: elements!, redirect: 'if_required' });
		if (result.error) {
			handleError(result.error);
		} else {
			await onconfirmed();
		}
		submitting = false;
	}
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
	<div class="modal-box max-w-md border border-card-border">
		<h3 class="font-display text-xl font-bold text-base-content">{title}</h3>

		{#if notice && !useSavedCard}
			<p class="mt-2 text-sm text-base-content-muted">{notice}</p>
		{/if}

		{#if useSavedCard && savedCard}
			<button
				type="button"
				class="btn btn-primary mt-4 w-full"
				disabled={submitting || finished}
				onclick={submit}
			>
				{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
				{submitLabel} with {cardLabel(savedCard)}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm mt-2 w-full"
				disabled={submitting || finished}
				onclick={() => (useSavedCard = false)}
			>
				Use another card
			</button>
		{:else}
			<div class="mt-4 min-h-24" bind:this={elementHost}></div>
		{/if}

		{#if message}
			<p class="mt-3 text-sm font-medium text-error" role="alert">{message}</p>
		{/if}

		<div class="modal-action">
			<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={submitting}>
				{finished ? 'Close' : 'Cancel'}
			</button>
			{#if !useSavedCard && !finished}
				<button
					type="button"
					class="btn btn-primary"
					disabled={submitting || !elements}
					onclick={submit}
				>
					{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
					{submitLabel}
				</button>
			{/if}
		</div>
	</div>
	<button
		type="button"
		class="modal-backdrop"
		onclick={oncancel}
		disabled={submitting}
		aria-label="Close"
	></button>
</div>
