<script lang="ts">
	/** Referrals screen body (design 12a) — identical for providers and
	 * families: invite-by-email form, stats row, invite list with status. */
	import { matchError } from '$lib/api/client';
	import type { Role } from '$lib/api/auth';
	import {
		listReferrals,
		sendReferralInvite,
		type ReferralEntry,
		type ReferralList
	} from '$lib/api/referrals';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let data = $state<ReferralList | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	let email = $state('');
	let role: Role = $state('service-provider');
	let sending = $state(false);
	let formError = $state('');
	let formNotice = $state('');

	async function load() {
		loadError = '';
		const result = await listReferrals();
		if (result.ok) {
			data = result.data;
		} else {
			loadError =
				result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHORIZED'
					? 'You need to be signed in to see your referrals.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
		void load();
	});

	const canSend = $derived(email.includes('@') && !sending);

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) return;
		sending = true;
		formError = '';
		formNotice = '';
		const result = await sendReferralInvite({ email, role });
		if (result.ok) {
			formNotice = `Invite sent to ${result.data.email}.`;
			email = '';
			await load();
		} else {
			formError = matchError(result.error, {
				REFERRAL_ALREADY_INVITED: () => 'You already have a pending invite for this email.',
				REFERRAL_EMAIL_ALREADY_MEMBER: () => 'This person is already on Poppynz.',
				INVALID_REFERRAL_INPUT: () => "That email address doesn't look right. Check it and try again.",
				REFERRAL_INVITE_SEND_FAILED: () => "We couldn't send the invite. Please try again.",
				REFERRAL_LOOKUP_FAILED: () => RETRY_MESSAGE,
				UNAUTHORIZED: () => 'You need to be signed in to send invites.',
				FORBIDDEN: () => 'You need to be signed in to send invites.',
				AUTH_PROVIDER_FAILED: () => RETRY_MESSAGE,
				AUTH_ENTITY_LOOKUP_FAILED: () => RETRY_MESSAGE,
				INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
				UNEXPECTED: () => RETRY_MESSAGE
			});
		}
		sending = false;
	}

	function initials(entry: ReferralEntry): string {
		if (entry.name) {
			return entry.name
				.split(' ')
				.map((part) => part.charAt(0))
				.join('')
				.slice(0, 2)
				.toUpperCase();
		}
		return entry.email.slice(0, 2).toUpperCase();
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
	}

	function detailText(entry: ReferralEntry): string {
		if (entry.status === 'joined' && entry.joinedAt) {
			const joined = `Joined ${formatDate(entry.joinedAt)}`;
			if (entry.verified) return `${joined} · now a verified helper`;
			return `${joined} · ${entry.role === 'family' ? 'family' : 'caregiver'}`;
		}
		if (entry.status === 'expired') return 'Invite expired';
		return `Invited ${formatDate(entry.invitedAt)}`;
	}

	const statusChipClass: Record<ReferralEntry['status'], string> = {
		joined: 'bg-success-content text-success',
		invited: 'bg-info-content text-info',
		expired: 'bg-base-300 text-base-content-muted'
	};

	const statusLabel: Record<ReferralEntry['status'], string> = {
		joined: 'Joined',
		invited: 'Invited',
		expired: 'Expired'
	};
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Referrals</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Know a great helper or a family who needs one? Invite them — referrals build trust on both
		profiles.
	</p>

	<form
		class="mb-5 rounded-xl border border-card-border bg-base-100 p-5 lg:p-6"
		onsubmit={send}
	>
		<div class="mb-3 text-[15px] font-bold text-base-content">Invite by email</div>
		<div class="flex flex-col gap-2.5 sm:flex-row">
			<label class="input min-w-0 flex-1">
				<i class="las la-envelope text-base text-outline" aria-hidden="true"></i>
				<input
					type="email"
					placeholder="their.email@example.com"
					required
					bind:value={email}
				/>
			</label>
			<select class="select sm:w-44" bind:value={role} aria-label="Invite as">
				<option value="service-provider">As a caregiver</option>
				<option value="family">As a family</option>
			</select>
			<button type="submit" class="btn btn-primary" disabled={!canSend}>
				{#if sending}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Send invite
			</button>
		</div>
		<p class="mt-2.5 text-xs text-outline">
			They get an email from Poppynz with your name on it. Invites expire after 14 days.
		</p>
		{#if formError}
			<p role="alert" class="mt-2 text-sm font-medium text-error">{formError}</p>
		{/if}
		{#if formNotice}
			<p role="status" class="mt-2 text-sm font-medium text-success">{formNotice}</p>
		{/if}
	</form>

	{#if loading}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if loadError}
		<p role="alert" class="text-sm font-medium text-error">{loadError}</p>
	{:else if data}
		<div class="mb-5 flex gap-3">
			<div class="flex-1 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
				<div class="text-[22px] font-bold text-secondary">{data.stats.sent}</div>
				<div class="text-xs text-base-content-muted">invites sent</div>
			</div>
			<div class="flex-1 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
				<div class="text-[22px] font-bold text-success">{data.stats.joined}</div>
				<div class="text-xs text-base-content-muted">joined Poppynz</div>
			</div>
			<div class="flex-1 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
				<div class="text-[22px] font-bold text-neutral">{data.stats.verified}</div>
				<div class="text-xs text-base-content-muted">now verified</div>
			</div>
		</div>

		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Your invites
		</div>
		{#if data.referrals.length === 0}
			<p
				class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm
					text-base-content-muted"
			>
				No invites yet — know someone who'd be great on Poppynz?
			</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each data.referrals as entry (entry.id)}
					<div
						class="flex items-center gap-3 rounded-[10px] border border-card-border bg-base-100
							px-4 py-3.5"
					>
						<span
							class="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px]
								font-bold {entry.status === 'expired'
								? 'bg-base-300 text-outline'
								: 'bg-base-400 text-secondary'}"
						>
							{initials(entry)}
						</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-[13.5px] font-semibold text-base-content">
								{entry.name ?? '—'}
							</div>
							<div class="truncate text-[11.5px] text-outline">{entry.email}</div>
						</div>
						<span class="hidden text-xs text-base-content-muted sm:block">{detailText(entry)}</span>
						<span
							class="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap
								{statusChipClass[entry.status]}"
						>
							{statusLabel[entry.status]}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
