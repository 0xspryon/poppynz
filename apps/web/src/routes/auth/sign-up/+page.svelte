<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { requestMagicLink, type Role } from '$lib/api/auth';
	import RoleChooser from '$lib/components/RoleChooser.svelte';

	let role: Role = $state('family');
	let email = $state('');
	let agreed = $state(false);
	let submitting = $state(false);

	const canSubmit = $derived(email.includes('@') && agreed);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit || submitting) return;
		submitting = true;
		await requestMagicLink({ email, role, intent: 'sign-up' });
		await goto(resolve('/auth/check-email'));
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
