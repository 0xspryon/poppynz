<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { getPendingAuth, resendMagicLink, type PendingAuth } from '$lib/api/auth';
	import Button from '$lib/components/Button.svelte';

	const RESEND_COOLDOWN_S = 60;

	let pending: PendingAuth | null = $state(getPendingAuth());
	let now = $state(Date.now());
	let resending = $state(false);

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

	async function resend() {
		if (resending || cooldownLeft > 0) return;
		resending = true;
		pending = await resendMagicLink();
		resending = false;
	}
</script>

<svelte:head>
	<title>Check your inbox · Poppynz</title>
</svelte:head>

<div class="max-w-form lg:my-auto lg:pb-12">
	<div
		class="mb-6 flex size-20 items-center justify-center rounded-pill bg-base-400"
	>
		<i class="las la-envelope text-4xl text-primary" aria-hidden="true"></i>
	</div>

	<h2 class="mb-2.5 font-display text-3xl font-bold text-base-content lg:text-4xl">Check your inbox</h2>
	<p class="mb-1 text-base text-base-content-muted">We sent a secure sign-in link to</p>
	<p class="mb-6 text-base font-semibold text-secondary">{pending?.email ?? 'your email address'}</p>

	<p
		class="mb-7 flex max-w-md items-center gap-2.5 rounded-md border border-warning-border
			bg-warning-content px-4 py-3 text-sm font-medium text-warning"
	>
		<i class="las la-clock text-base" aria-hidden="true"></i>
		The link expires in 5 minutes — open it soon.
	</p>

	<div class="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
		{#if cooldownLeft > 0}
			<Button variant="muted" disabled>Resend link in {countdown}</Button>
		{:else}
			<Button variant="muted" loading={resending} onclick={resend}>Resend link</Button>
		{/if}
		<p class="text-sm text-base-content-muted">
			Wrong email? <a href={resolve('/auth/sign-up')} class="font-semibold text-primary">Start over</a>
		</p>
	</div>

	<p class="text-sm leading-relaxed text-outline">
		Nothing arriving? Check your spam folder, or make sure
		{pending?.email ?? 'your email'} is spelled right.
	</p>

	<!-- Dev-only stand-in for the real email while the API is mocked -->
	<div class="mt-10 rounded-lg border-2 border-dashed border-outline-variant p-4">
		<p class="mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-outline uppercase">
			<i class="las la-flask text-base" aria-hidden="true"></i>
			Mock inbox — dev only
		</p>
		<div class="flex flex-wrap gap-3 text-sm font-semibold">
			<a
				href="{resolve('/auth/verify')}?token=demo"
				class="rounded-md bg-base-400 px-4 py-2 text-secondary transition hover:bg-base-500"
			>
				<i class="las la-external-link-alt" aria-hidden="true"></i> Open magic link
			</a>
			<a
				href="{resolve('/auth/verify')}?token=expired"
				class="rounded-md bg-error-content px-4 py-2 text-error transition hover:brightness-95"
			>
				<i class="las la-hourglass-end" aria-hidden="true"></i> Open expired link
			</a>
		</div>
	</div>
</div>
