<script lang="ts">
	/** A helper's vouch requests: ask an approved member by email, then track
	 * each request. Answers and the reason a vouch stopped counting are never
	 * shown here — "Not counted" is all the applicant learns. */
	import { matchError } from '$lib/api/client';
	import { requestVouch, type MyVouch, type MyVouches } from '$lib/api/vouches';
	import { toast } from '$lib/toast.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		data: MyVouches;
		onchanged: () => Promise<void>;
	}

	let { data, onchanged }: Props = $props();

	const RETRY_MESSAGE = m.common_error_generic();

	let email = $state('');
	let relationship = $state('');
	let sending = $state(false);
	let formError = $state('');

	const canSend = $derived(email.includes('@') && relationship.trim().length > 0 && !sending);

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) return;
		sending = true;
		formError = '';
		const result = await requestVouch({ email, relationship });
		if (result.ok) {
			// The same answer whoever the email belongs to (UAT #36).
			toast.success(m.vouches_request_sent_body(), { title: m.vouches_request_sent_title() });
			email = '';
			relationship = '';
			await onchanged();
		} else {
			formError = matchError(result.error, {
				VOUCH_APPLICANT_ONLY: () => m.vouches_error_applicant_only(),
				VOUCH_RATE_LIMITED: () => m.vouches_error_rate_limited(),
				INVALID_VOUCH_INPUT: () => m.vouches_error_invalid_input(),
				VOUCH_LOOKUP_FAILED: () => RETRY_MESSAGE,
				VOUCH_NOT_FOUND: () => RETRY_MESSAGE,
				VOUCH_STATE_INVALID: () => RETRY_MESSAGE,
				VOUCH_LOCKED: () => RETRY_MESSAGE,
				UNAUTHORIZED: () => m.vouches_error_signed_in(),
				FORBIDDEN: () => m.vouches_error_signed_in(),
				AUTH_PROVIDER_FAILED: () => RETRY_MESSAGE,
				AUTH_ENTITY_LOOKUP_FAILED: () => RETRY_MESSAGE,
				INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
				UNEXPECTED: () => RETRY_MESSAGE
			});
		}
		sending = false;
	}

	const chipClass: Record<MyVouch['status'], string> = {
		pending: 'bg-info-content text-info',
		completed: 'bg-success-content text-success',
		declined: 'bg-base-300 text-base-content-muted',
		expired: 'bg-base-300 text-base-content-muted',
		not_counted: 'bg-warning-content text-warning'
	};
	const chipLabel: Record<MyVouch['status'], string> = {
		pending: m.vouches_status_pending(),
		completed: m.vouches_status_completed(),
		declined: m.vouches_status_declined(),
		expired: m.vouches_status_expired(),
		not_counted: m.vouches_status_not_counted()
	};
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5 lg:p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<div class="text-[15px] font-bold text-base-content">
			{m.vouches_panel_heading({ counting: data.counting, recommended: data.recommended })}
		</div>
		{#if data.counting < data.recommended}
			<span class="text-xs text-base-content-muted">
				{m.vouches_panel_optional()}
			</span>
		{/if}
	</div>
	<p class="mt-1 text-[13px] text-base-content-muted">
		{m.vouches_panel_intro()}
	</p>

	<form class="mt-4 flex flex-col gap-2.5" onsubmit={send}>
		<div class="flex flex-col gap-2.5 sm:flex-row">
			<label class="input min-w-0 flex-1">
				<i class="las la-envelope text-base text-outline" aria-hidden="true"></i>
				<input
					type="email"
					placeholder={m.vouches_email_placeholder()}
					required
					bind:value={email}
				/>
			</label>
			<label class="input min-w-0 flex-1">
				<input
					type="text"
					maxlength="300"
					placeholder={m.vouches_relationship_placeholder()}
					required
					bind:value={relationship}
				/>
			</label>
			<button type="submit" class="btn btn-primary" disabled={!canSend}>
				{#if sending}<span class="loading loading-spinner loading-xs"></span>{/if}
				{m.vouches_ask()}
			</button>
		</div>
		{#if formError}
			<p role="alert" class="text-sm font-medium text-error">{formError}</p>
		{/if}
	</form>

	{#if data.vouches.length > 0}
		<div class="mt-4 flex flex-col gap-2">
			{#each data.vouches as vouch (vouch.id)}
				<div class="flex items-center gap-3 rounded-[10px] border border-card-border px-4 py-3">
					<div class="min-w-0 flex-1">
						<!-- The name shows once they answer; until then only the email you typed. -->
						<div class="truncate text-[13.5px] font-semibold text-base-content">
							{vouch.voucherName ?? vouch.voucherEmail}
						</div>
						{#if vouch.voucherName}
							<div class="truncate text-[11.5px] text-outline">{vouch.voucherEmail}</div>
						{/if}
					</div>
					<span
						class="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap
							{chipClass[vouch.status]}"
					>
						{chipLabel[vouch.status]}
					</span>
				</div>
			{/each}
		</div>
		{#if data.vouches.some((vouch) => vouch.status === 'not_counted')}
			<p class="mt-2 text-xs text-warning">
				{m.vouches_not_counted_note()}
			</p>
		{/if}
	{/if}
</div>
