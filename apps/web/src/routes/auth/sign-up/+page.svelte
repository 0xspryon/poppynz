<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { requestSignUpLink, type Role } from '$lib/api/auth';
	import { matchError } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';
	import { listPublishedTcs, tcCheckboxLabel, type PublishedTc } from '$lib/api/tcs';
	import RoleChooser from '$lib/components/RoleChooser.svelte';
	import TcModal from '$lib/components/TcModal.svelte';

	const RETRY_MESSAGE = m.auth_retry_message();
	// Static fallback while the published terms load (or if the fetch fails);
	// matches the seeded terms_of_service checkbox label.
	const TERMS_CHECKBOX_FALLBACK = m.auth_signup_terms_fallback();

	// Referral invite links land here with ?email=…&role=… prefilled.
	const invitedRole = page.url.searchParams.get('role');
	let role: Role = $state(
		invitedRole === 'family' || invitedRole === 'service-provider' ? invitedRole : 'family'
	);
	let email = $state(page.url.searchParams.get('email') ?? '');
	let agreed = $state(false);
	let submitting = $state(false);
	let errorMessage: string | null = $state(null);
	let terms = $state<PublishedTc | null>(null);
	let termsOpen = $state(false);

	// Acceptance itself is recorded after the magic-link sign-in (the terms
	// gate in the role layouts) — this is the read-and-agree step.
	$effect(() => {
		const forRole = role;
		if (!browser) return;
		void listPublishedTcs(forRole).then((result) => {
			if (result.ok) {
				terms = result.data.find((tc) => tc.slug === 'terms_of_service') ?? null;
			}
		});
	});

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
			USER_ALREADY_EXISTS: () => m.auth_error_signup_user_exists(),
			INVALID_SIGNUP_INPUT: () => m.auth_error_invalid_email(),
			SIGNUP_LINK_FAILED: () => m.auth_error_signup_link_failed(),
			SIGNUP_INTENT_FAILED: () => RETRY_MESSAGE,
			SIGNUP_USER_LOOKUP_FAILED: () => RETRY_MESSAGE,
			INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
			UNEXPECTED: () => RETRY_MESSAGE
		});
		submitting = false;
	}
</script>

<svelte:head>
	<title>{m.shell_page_title({ title: m.auth_signup_title() })}</title>
</svelte:head>

<form class="max-w-form" onsubmit={submit}>
	<h2 class="mb-2 font-display text-3xl font-bold text-base-content lg:text-4xl">
		{m.auth_signup_heading()}
	</h2>
	<p class="mb-8 text-base text-base-content-muted">
		{m.auth_signup_lead()}
	</p>

	<p class="mb-3 text-xs font-semibold tracking-widest text-neutral uppercase">
		{m.auth_signup_joining_as()}
	</p>
	<div class="mb-7">
		<RoleChooser bind:value={role} />
	</div>

	<fieldset class="fieldset mb-6">
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

	<label class="label mb-7 items-start gap-2.5 text-sm whitespace-normal">
		<input type="checkbox" class="checkbox checkbox-primary checkbox-sm" bind:checked={agreed} />
		<span>
			{terms ? tcCheckboxLabel(terms) : TERMS_CHECKBOX_FALLBACK}
			{#if terms}
				<button
					type="button"
					class="font-semibold text-primary underline"
					onclick={() => (termsOpen = true)}
				>
					{m.auth_signup_read_terms()}
				</button>
			{/if}
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
		{m.auth_signup_link_note()}
	</p>
</form>

{#if terms}
	<TcModal
		open={termsOpen}
		mode="view"
		title={terms.title}
		content={terms.content}
		notice={terms.fallback ? m.tc_english_governs_notice() : null}
		onclose={() => (termsOpen = false)}
	/>
{/if}
