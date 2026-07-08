<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getPendingAuth, requestSignInLink, requestSignUpLink } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let email = $state('');
	let submitting = $state(false);
	let errorMessage: string | null = $state(null);

	const canSubmit = $derived(email.includes('@'));

	onMount(() => {
		email = getPendingAuth()?.email ?? '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMessage = null;
		const previous = getPendingAuth();
		const result =
			previous?.intent === 'sign-up' && previous.role
				? await requestSignUpLink({ email, role: previous.role })
				: await requestSignInLink({ email });
		if (result.ok) {
			await goto(resolve('/auth/check-email'));
			return;
		}
		errorMessage = matchError(result.error, {
			USER_NOT_FOUND: () => 'No account exists for this email — create one instead.',
			USER_ALREADY_EXISTS: () => 'Your account already exists — sign in instead.',
			INVALID_SIGNIN_INPUT: () => "That email address doesn't look right. Check it and try again.",
			INVALID_SIGNUP_INPUT: () => "That email address doesn't look right. Check it and try again.",
			SIGNIN_LINK_FAILED: () => "We couldn't send your sign-in link. Please try again.",
			SIGNUP_LINK_FAILED: () => "We couldn't send your magic link. Please try again.",
			SIGNIN_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			SIGNUP_INTENT_FAILED: () => RETRY_MESSAGE,
			SIGNUP_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
			UNEXPECTED: () => RETRY_MESSAGE
		});
		submitting = false;
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

	{#if errorMessage}
		<p
			class="mb-5 flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content
				px-4 py-3 text-sm font-medium text-error"
			role="alert"
		>
			<i class="las la-exclamation-circle text-base" aria-hidden="true"></i>
			{errorMessage}
		</p>
	{/if}

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
