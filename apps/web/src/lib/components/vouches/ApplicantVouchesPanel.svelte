<script lang="ts">
	/** A helper's vouch requests: ask an approved member by email, then track
	 * each request. Answers and the reason a vouch stopped counting are never
	 * shown here — "Not counted" is all the applicant learns. */
	import { matchError } from '$lib/api/client';
	import { requestVouch, type MyVouch, type MyVouches } from '$lib/api/vouches';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		data: MyVouches;
		onchanged: () => Promise<void>;
	}

	let { data, onchanged }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

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
			toast.success('Request sent. We’ve let them know.');
			email = '';
			relationship = '';
			await onchanged();
		} else {
			formError = matchError(result.error, {
				VOUCHER_UNAVAILABLE: () =>
					"We couldn't send a request to that email. Check it belongs to an approved Poppynz member.",
				VOUCH_ALREADY_REQUESTED: () => 'You already have an open request with this person.',
				VOUCH_APPLICANT_ONLY: () => 'Only helpers can ask for vouches.',
				INVALID_VOUCH_INPUT: () => 'Check the email and how you know them, then try again.',
				VOUCH_LOOKUP_FAILED: () => RETRY_MESSAGE,
				VOUCH_NOT_FOUND: () => RETRY_MESSAGE,
				VOUCH_STATE_INVALID: () => RETRY_MESSAGE,
				VOUCH_LOCKED: () => RETRY_MESSAGE,
				UNAUTHORIZED: () => 'You need to be signed in.',
				FORBIDDEN: () => 'You need to be signed in.',
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
		pending: 'Pending',
		completed: 'Completed',
		declined: 'Declined',
		expired: 'Expired',
		not_counted: 'Not counted'
	};
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5 lg:p-6">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<div class="text-[15px] font-bold text-base-content">
			Vouches · {data.counting} of {data.recommended} recommended
		</div>
		{#if data.counting < data.recommended}
			<span class="text-xs text-base-content-muted">
				Optional — without them we'll email you to arrange a quick chat.
			</span>
		{/if}
	</div>
	<p class="mt-1 text-[13px] text-base-content-muted">
		Ask two approved Poppynz members who know you personally — a family or a helper. Their answers
		go only to our team.
	</p>

	<form class="mt-4 flex flex-col gap-2.5" onsubmit={send}>
		<div class="flex flex-col gap-2.5 sm:flex-row">
			<label class="input min-w-0 flex-1">
				<i class="las la-envelope text-base text-outline" aria-hidden="true"></i>
				<input type="email" placeholder="their.email@example.com" required bind:value={email} />
			</label>
			<label class="input min-w-0 flex-1">
				<input
					type="text"
					maxlength="300"
					placeholder="How do you know them? e.g. I nanny for their family"
					required
					bind:value={relationship}
				/>
			</label>
			<button type="submit" class="btn btn-primary" disabled={!canSend}>
				{#if sending}<span class="loading loading-spinner loading-xs"></span>{/if}
				Ask to vouch
			</button>
		</div>
		{#if formError}
			<p role="alert" class="text-sm font-medium text-error">{formError}</p>
		{/if}
	</form>

	{#if data.vouches.length > 0}
		<div class="mt-4 flex flex-col gap-2">
			{#each data.vouches as vouch (vouch.id)}
				<div
					class="flex items-center gap-3 rounded-[10px] border border-card-border px-4 py-3"
				>
					<div class="min-w-0 flex-1">
						<div class="truncate text-[13.5px] font-semibold text-base-content">
							{vouch.voucherName}
						</div>
						<div class="truncate text-[11.5px] text-outline">{vouch.voucherEmail}</div>
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
				A vouch needs attention and isn't counted. You can ask someone else.
			</p>
		{/if}
	{/if}
</div>
