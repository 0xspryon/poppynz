<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestSignInLink } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let email = $state('');
	let submitting = $state(false);
	let errorMessage: string | null = $state(null);

	const canSubmit = $derived(email.includes('@'));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMessage = null;
		const result = await requestSignInLink({ email });
		if (result.ok) {
			await goto(resolve('/auth/check-email'));
			return;
		}
		errorMessage = matchError(result.error, {
			USER_NOT_FOUND: () => 'No account exists for this email — create one instead.',
			INVALID_SIGNIN_INPUT: () => "That email address doesn't look right. Check it and try again.",
			SIGNIN_LINK_FAILED: () => "We couldn't send your sign-in link. Please try again.",
			SIGNIN_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
			UNEXPECTED: () => RETRY_MESSAGE
		});
		submitting = false;
	}
</script>

<svelte:head>
	<title>Sign in · Poppynz</title>
</svelte:head>

<form class="max-w-form lg:my-auto lg:pb-16" onsubmit={submit}>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content lg:text-4xl">
		Sign in to Poppynz
	</h2>
	<p class="mb-8 text-base text-base-content-muted">
		We'll email you a secure link — it signs you in with one tap.
	</p>

	<fieldset class="fieldset mb-7">
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

	<button
		type="submit"
		class="btn btn-lg btn-primary btn-block"
		disabled={!canSubmit || submitting}
	>
		{#if submitting}
			<span class="loading loading-spinner"></span>
		{/if}
		Email me a magic link <i class="las la-arrow-right" aria-hidden="true"></i>
	</button>

	<p class="mt-4 flex items-center justify-center gap-2 text-sm text-base-content-muted">
		<i class="las la-lock text-outline" aria-hidden="true"></i>
		The link is single-use and expires in 5 minutes.
	</p>
</form>
