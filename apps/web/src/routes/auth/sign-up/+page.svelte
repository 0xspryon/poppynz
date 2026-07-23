<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { requestSignUpLink, type Role } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';
	import RoleChooser from '$lib/components/RoleChooser.svelte';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	// Referral invite links land here with ?email=…&role=… prefilled.
	const invitedRole = page.url.searchParams.get('role');
	let role: Role = $state(
		invitedRole === 'family' || invitedRole === 'service-provider' ? invitedRole : 'family'
	);
	let email = $state(page.url.searchParams.get('email') ?? '');
	let agreed = $state(false);
	let submitting = $state(false);
	let errorMessage: string | null = $state(null);

	const canSubmit = $derived(email.includes('@') && agreed);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMessage = null;
		const result = await requestSignUpLink({ email, role });
		if (result.ok) {
			await goto(resolve('/auth/check-email'));
			return;
		}
		errorMessage = matchError(result.error, {
			USER_ALREADY_EXISTS: () => 'An account already exists for this email — sign in instead.',
			INVALID_SIGNUP_INPUT: () => "That email address doesn't look right. Check it and try again.",
			SIGNUP_LINK_FAILED: () => "We couldn't send your magic link. Please try again.",
			SIGNUP_INTENT_FAILED: () => RETRY_MESSAGE,
			SIGNUP_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
			UNEXPECTED: () => RETRY_MESSAGE
		});
		submitting = false;
	}
</script>

<svelte:head>
	<title>Create your account · Poppynz</title>
</svelte:head>

<form class="max-w-form" onsubmit={submit}>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content lg:text-4xl">
		Create your Poppynz account
	</h2>
	<p class="mb-8 text-base text-base-content-muted">
		Free to join. No password — we email you a secure link.
	</p>

	<p class="mb-3 text-xs font-semibold tracking-widest text-neutral uppercase">I'm joining as</p>
	<div class="mb-7">
		<RoleChooser bind:value={role} />
	</div>

	<fieldset class="fieldset mb-6">
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

	<label class="label mb-7 items-start gap-2.5 text-sm whitespace-normal">
		<input type="checkbox" class="checkbox checkbox-primary checkbox-sm" bind:checked={agreed} />
		<span>
			<!-- Terms & privacy pages don't exist yet — placeholder anchors -->
			I agree to Poppynz's <a href="#terms" class="font-semibold text-primary">Terms</a> and
			acknowledge the
			<a href="#privacy" class="font-semibold text-primary">Privacy Policy</a> (PIPEDA-compliant).
		</span>
	</label>

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
		Email me a magic link <i class="las la-arrow-right" aria-hidden="true"></i>
	</button>

	<p class="mt-4 flex items-center justify-center gap-2 text-sm text-base-content-muted">
		<i class="las la-lock text-outline" aria-hidden="true"></i>
		No password needed — the link signs you in securely and expires in 5 minutes.
	</p>
</form>
