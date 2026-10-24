<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getDevMagicLink, getPendingAuth, resendMagicLink, type PendingAuth } from '$lib/api/auth';
	import { toast } from '$lib/toast.svelte';

	// The mock inbox exists only in local dev builds (UAT #32).
	const devInbox = import.meta.env.DEV;
	let openingLink = $state(false);

	/** Opens the real link the API just mailed — not a placeholder token. */
	async function openLatestLink() {
		if (!pending || openingLink) return;
		openingLink = true;
		const result = await getDevMagicLink(pending.email);
		openingLink = false;
		if (result.ok) {
			window.location.assign(result.data.link);
		} else {
			toast.error(
				result.error.code === 'DEV_INBOX_EMPTY'
					? 'No magic link has been sent to this address since the API started — use Resend.'
					: 'The mock inbox is only available against a local dev API.',
				{ title: 'No link to open' }
			);
		}
	}
	import { matchError } from '$lib/api/client';

	const RESEND_COOLDOWN_S = 60;

	let pending: PendingAuth | null = $state(getPendingAuth());
	let now = $state(Date.now());
	let resending = $state(false);
	let resendError: string | null = $state(null);

	const cooldownLeft = $derived(
		pending ? Math.max(0, RESEND_COOLDOWN_S - Math.floor((now - pending.sentAt) / 1000)) : 0
	);
	const countdown = $derived(
		`${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, '0')}`
	);

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const RETRY_MESSAGE = "We couldn't resend the link. Please try again.";

	async function resend() {
		if (resending || cooldownLeft > 0) return;
		resending = true;
		resendError = null;
		const result = await resendMagicLink();
		if (result === null) {
			// Nothing pending anymore (e.g. storage cleared) — send them back to the start.
			pending = null;
		} else if (result.ok) {
			pending = result.data;
		} else {
			resendError = matchError(result.error, {
				USER_ALREADY_EXISTS: () => 'Your account already exists — sign in instead.',
				USER_NOT_FOUND: () => 'No account exists for this email anymore — start over below.',
				INVALID_SIGNUP_INPUT: () => RETRY_MESSAGE,
				INVALID_SIGNIN_INPUT: () => RETRY_MESSAGE,
				SIGNUP_INTENT_FAILED: () => RETRY_MESSAGE,
				SIGNUP_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
				SIGNUP_LINK_FAILED: () => RETRY_MESSAGE,
				SIGNIN_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
				SIGNIN_LINK_FAILED: () => RETRY_MESSAGE,
				INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
				UNEXPECTED: () => RETRY_MESSAGE
			});
		}
		resending = false;
	}
</script>

<svelte:head>
	<title>Check your inbox · Poppynz</title>
</svelte:head>

<div class="max-w-form lg:my-auto lg:pb-12">
	<div class="mb-6 flex size-20 items-center justify-center rounded-pill bg-base-400">
		<i class="las la-envelope text-4xl text-primary" aria-hidden="true"></i>
	</div>

	<h2 class="mb-2.5 font-display text-3xl font-bold text-base-content lg:text-4xl">
		Check your inbox
	</h2>
	<p class="mb-1 text-base text-base-content-muted">We sent a secure sign-in link to</p>
	<p class="mb-6 text-base font-semibold text-secondary">
		{pending?.email ?? 'your email address'}
	</p>

	<p
		class="mb-7 flex max-w-md items-center gap-2.5 rounded-md border border-warning-border
			bg-warning-content px-4 py-3 text-sm font-medium text-warning"
	>
		<i class="las la-clock text-base" aria-hidden="true"></i>
		The link expires in 5 minutes — open it soon.
	</p>

	<div class="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
		{#if cooldownLeft > 0}
			<button class="btn btn-outline" disabled>Resend link in {countdown}</button>
		{:else}
			<button class="btn btn-outline" onclick={resend} disabled={resending}>
				{#if resending}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				Resend link
			</button>
		{/if}
		<p class="text-sm text-base-content-muted">
			Wrong email?
			<a href={resolve('/auth/sign-up')} class="font-semibold text-primary">Start over</a>
		</p>
	</div>

	{#if resendError}
		<p class="mb-5 text-sm font-medium text-error" role="alert">{resendError}</p>
	{/if}

	<p class="text-sm leading-relaxed text-outline">
		Nothing arriving? Check your spam folder, or make sure
		{pending?.email ?? 'your email'} is spelled right.
	</p>

	{#if devInbox}
		<!-- Dev-only stand-in for the mailbox: opens the real link the API sent. -->
		<div class="mt-10 rounded-lg border-2 border-dashed border-outline-variant p-4">
			<p
				class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-outline uppercase"
			>
				<i class="las la-flask text-base" aria-hidden="true"></i>
				Mock inbox — dev only
			</p>
			<div class="flex flex-wrap gap-3">
				<button
					type="button"
					class="btn btn-sm btn-soft btn-secondary"
					disabled={!pending || openingLink}
					onclick={() => void openLatestLink()}
				>
					<i class="las la-external-link-alt" aria-hidden="true"></i> Open magic link
				</button>
				<a href="{resolve('/auth/verify')}?token=expired" class="btn btn-sm btn-soft btn-error">
					<i class="las la-hourglass-end" aria-hidden="true"></i> Open expired link
				</a>
			</div>
		</div>
	{/if}

</div>
