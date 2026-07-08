<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getPendingAuth, requestMagicLink } from '$lib/api/auth';

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

	<h2 class="mb-2.5 font-display text-3xl font-bold text-base-content lg:text-4xl">
		This link has expired
	</h2>
	<p class="mb-7 max-w-md text-base leading-relaxed text-base-content-muted">
		Sign-in links only work for 5 minutes. Enter your email and we'll send a fresh one right away.
	</p>

	<fieldset class="fieldset mb-4">
		<legend class="fieldset-legend">Email</legend>
		<label class="input input-lg w-full">
			<i class="las la-envelope text-outline" aria-hidden="true"></i>
			<input
				type="email"
				class="grow"
				placeholder="johndoe@email.com"
				required
				autocomplete="email"
				bind:value={email}
			/>
		</label>
	</fieldset>

	<button type="submit" class="btn btn-lg btn-primary btn-block" disabled={!canSubmit || submitting}>
		{#if submitting}
			<span class="loading loading-spinner"></span>
		{/if}
		Send me a new link
	</button>

	<p class="mt-5 text-center text-sm text-base-content-muted">
		<!-- Support page doesn't exist yet — placeholder anchor -->
		Need help? <a href="#support" class="font-semibold text-primary">Contact support</a>
	</p>
</form>
