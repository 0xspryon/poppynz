<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getPendingAuth, requestSignInLink, requestSignUpLink } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';

	const RETRY_MESSAGE = m.auth_retry_message();

	// Forwarded by the sign-in/sign-up error routes from better-auth's
	// errorCallbackURL. INVALID_TOKEN (used or expired link) gets the default
	// stale-link copy; failed_to_* are server-side failures during verification.
	const SERVER_FAILURE_CODES = ['failed_to_create_user', 'failed_to_create_session'];
	const serverFailure = $derived(
		SERVER_FAILURE_CODES.includes(page.url.searchParams.get('error') ?? '')
	);

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
			USER_NOT_FOUND: () => m.auth_error_user_not_found_create(),
			USER_ALREADY_EXISTS: () => m.auth_error_user_exists_sign_in(),
			INVALID_SIGNIN_INPUT: () => m.auth_error_invalid_email(),
			INVALID_SIGNUP_INPUT: () => m.auth_error_invalid_email(),
			SIGNIN_LINK_FAILED: () => m.auth_error_signin_link_failed(),
			SIGNUP_LINK_FAILED: () => m.auth_error_signup_link_failed(),
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
	<title
		>{m.shell_page_title({
			title: serverFailure ? m.auth_expired_title_failed() : m.auth_expired_title_expired()
		})}</title
	>
</svelte:head>

<form class="max-w-form lg:my-auto lg:pb-12" onsubmit={submit}>
	<div class="mb-6 flex size-18 items-center justify-center rounded-pill bg-error-content">
		<i
			class="las {serverFailure ? 'la-exclamation-circle' : 'la-clock'} text-3xl text-error"
			aria-hidden="true"
		></i>
	</div>

	<h2 class="mb-2.5 font-display text-3xl font-bold text-base-content lg:text-4xl">
		{serverFailure ? m.auth_expired_heading_failed() : m.auth_expired_heading_expired()}
	</h2>
	<p class="mb-7 max-w-md text-base leading-relaxed text-base-content-muted">
		{serverFailure ? m.auth_expired_body_failed() : m.auth_expired_body_expired()}
	</p>

	<fieldset class="fieldset mb-4">
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
		{m.auth_expired_submit()}
	</button>

	<p class="mt-5 text-center text-sm text-base-content-muted">
		<!-- Support page doesn't exist yet — placeholder anchor -->
		{m.auth_expired_need_help()}
		<a href="#support" class="font-semibold text-primary">{m.auth_expired_contact_support()}</a>
	</p>
</form>
