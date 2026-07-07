<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getPendingAuth, requestMagicLink } from '$lib/api/auth';
	import Button from '$lib/components/Button.svelte';
	import EmailField from '$lib/components/EmailField.svelte';

	let email = $state('');
	let submitting = $state(false);

	const canSubmit = $derived(email.includes('@'));

	onMount(() => {
		email = getPendingAuth()?.email ?? '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		const previous = getPendingAuth();
		await requestMagicLink({
			email,
			role: previous?.role,
			intent: previous?.intent ?? 'sign-in'
		});
		await goto(resolve('/auth/check-email'));
	}
</script>

<svelte:head>
	<title>Link expired · Poppynz</title>
</svelte:head>

<form class="max-w-form lg:my-auto lg:pb-12" onsubmit={submit}>
	<div class="mb-6 flex size-18 items-center justify-center rounded-pill bg-error-content">
		<i class="las la-clock text-3xl text-error" aria-hidden="true"></i>
	</div>

	<h2 class="mb-2.5 font-display text-3xl font-bold text-base-content lg:text-4xl">This link has expired</h2>
	<p class="mb-7 max-w-md text-base leading-relaxed text-base-content-muted">
		Sign-in links only work for 5 minutes. Enter your email and we'll send a fresh one right away.
	</p>

	<div class="mb-4">
		<EmailField bind:value={email} label="Email" />
	</div>

	<Button type="submit" block loading={submitting} disabled={!canSubmit}>
		Send me a new link
	</Button>

	<p class="mt-5 text-center text-sm text-base-content-muted">
		<!-- Support page doesn't exist yet — placeholder anchor -->
		Need help? <a href="#support" class="font-semibold text-primary">Contact support</a>
	</p>
</form>
