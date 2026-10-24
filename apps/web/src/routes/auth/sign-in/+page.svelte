<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestSignInLink } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';

	const RETRY_MESSAGE = m.auth_retry_message();

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
			USER_NOT_FOUND: () => m.auth_error_user_not_found_create(),
			INVALID_SIGNIN_INPUT: () => m.auth_error_invalid_email(),
			SIGNIN_LINK_FAILED: () => m.auth_error_signin_link_failed(),
			SIGNIN_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
			UNEXPECTED: () => RETRY_MESSAGE
		});
		submitting = false;
	}
</script>

<svelte:head>
	<title>{m.shell_page_title({ title: m.auth_signin_title() })}</title>
</svelte:head>

<form class="max-w-form lg:my-auto lg:pb-16" onsubmit={submit}>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content lg:text-4xl">
		{m.auth_signin_heading()}
	</h2>
	<p class="mb-8 text-base text-base-content-muted">
		{m.auth_signin_lead()}
	</p>

	<fieldset class="fieldset mb-7">
		<legend class="fieldset-legend">{m.auth_email_label()}</legend>
		<label class="input input-lg w-full">
			<i class="las la-envelope text-outline" aria-hidden="true"></i>
			<input
				type="email"
				class="grow"
				placeholder={m.auth_email_placeholder()}
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
		{m.auth_magic_link_button()} <i class="las la-arrow-right" aria-hidden="true"></i>
	</button>

	<p class="mt-4 flex items-center justify-center gap-2 text-sm text-base-content-muted">
		<i class="las la-lock text-outline" aria-hidden="true"></i>
		{m.auth_signin_link_note()}
	</p>
</form>
