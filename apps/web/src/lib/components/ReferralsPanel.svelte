<script lang="ts">
	/** Referrals screen body (design 12a) — identical for providers and
	 * families: invite-by-email form, stats row, invite list with status. */
	import { onMount } from 'svelte';
	import { matchError } from '$lib/api/client';
	import type { Role } from '$lib/api/auth';
	import {
		listReferrals,
		sendReferralInvite,
		type ReferralEntry,
		type ReferralList
	} from '$lib/api/referrals';
	import { toast } from '$lib/toast.svelte';
	import { intlLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';

	const RETRY_MESSAGE = m.common_error_generic();

	let data = $state<ReferralList | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	let email = $state('');
	let role: Role = $state('service-provider');
	let sending = $state(false);
	let formError = $state('');

	async function load() {
		loadError = '';
		const result = await listReferrals();
		if (result.ok) {
			data = result.data;
		} else {
			loadError =
				result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHORIZED'
					? m.referrals_signed_in_to_see()
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	const canSend = $derived(email.includes('@') && !sending);

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) return;
		sending = true;
		formError = '';
		const result = await sendReferralInvite({ email, role });
		if (result.ok) {
			toast.success(m.referrals_invite_sent({ email: result.data.email }));
			email = '';
			await load();
		} else {
			const message: string = matchError(result.error, {
				REFERRAL_ALREADY_INVITED: () => m.referrals_error_already_invited(),
				REFERRAL_EMAIL_ALREADY_MEMBER: () => m.referrals_error_already_member(),
				INVALID_REFERRAL_INPUT: () => m.referrals_error_invalid_email(),
				REFERRAL_INVITE_SEND_FAILED: () => m.referrals_error_send_failed(),
				REFERRAL_LOOKUP_FAILED: () => RETRY_MESSAGE,
				UNAUTHORIZED: () => m.referrals_error_signed_in_to_send(),
				FORBIDDEN: () => m.referrals_error_signed_in_to_send(),
				AUTH_PROVIDER_FAILED: () => RETRY_MESSAGE,
				AUTH_ENTITY_LOOKUP_FAILED: () => RETRY_MESSAGE,
				INTERNAL_SERVER_ERROR: () => RETRY_MESSAGE,
				UNEXPECTED: () => RETRY_MESSAGE
			});
			if (result.error.code === 'INVALID_REFERRAL_INPUT') {
				// A bad email is fixed in the field — keep that message inline.
				formError = message;
			} else {
				toast.error(message, { title: m.referrals_not_sent_title() });
			}
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
		return new Date(iso).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
	}

	function detailText(entry: ReferralEntry): string {
		if (entry.status === 'joined' && entry.joinedAt) {
			const date = formatDate(entry.joinedAt);
			if (entry.verified) return m.referrals_detail_joined_verified({ date });
			return entry.role === 'family'
				? m.referrals_detail_joined_family({ date })
				: m.referrals_detail_joined_helper({ date });
		}
		if (entry.status === 'expired') return m.referrals_detail_expired();
		return m.referrals_detail_invited({ date: formatDate(entry.invitedAt) });
	}

	const statusChipClass: Record<ReferralEntry['status'], string> = {
		joined: 'bg-success-content text-success',
		invited: 'bg-info-content text-info',
		expired: 'bg-base-300 text-base-content-muted'
	};

	const statusLabel: Record<ReferralEntry['status'], string> = {
		joined: m.referrals_status_joined(),
		invited: m.referrals_status_invited(),
		expired: m.referrals_status_expired()
	};
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.referrals_heading()}</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{m.referrals_intro()}
	</p>

	<form class="mb-5 rounded-xl border border-card-border bg-base-100 p-5 lg:p-6" onsubmit={send}>
		<div class="mb-3 text-[15px] font-bold text-base-content">{m.referrals_invite_by_email()}</div>
		<div class="flex flex-col gap-2.5 sm:flex-row">
			<label class="input min-w-0 flex-1">
				<i class="las la-envelope text-base text-outline" aria-hidden="true"></i>
				<input
					type="email"
					placeholder={m.referrals_email_placeholder()}
					required
					bind:value={email}
				/>
			</label>
			<select class="select sm:w-44" bind:value={role} aria-label={m.referrals_invite_as_aria()}>
				<option value="service-provider">{m.referrals_as_helper()}</option>
				<option value="family">{m.referrals_as_family()}</option>
			</select>
			<button type="submit" class="btn btn-primary" disabled={!canSend}>
				{#if sending}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				{m.referrals_send()}
			</button>
		</div>
		<p class="mt-2.5 text-xs text-outline">
			{m.referrals_note()}
		</p>
		{#if formError}
			<p role="alert" class="mt-2 text-sm font-medium text-error">{formError}</p>
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
				<div class="text-xs text-base-content-muted">{m.referrals_stat_sent()}</div>
			</div>
			<div class="flex-1 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
				<div class="text-[22px] font-bold text-success">{data.stats.joined}</div>
				<div class="text-xs text-base-content-muted">{m.referrals_stat_joined()}</div>
			</div>
			<div class="flex-1 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5">
				<div class="text-[22px] font-bold text-neutral">{data.stats.verified}</div>
				<div class="text-xs text-base-content-muted">{m.referrals_stat_verified()}</div>
			</div>
		</div>

		<div class="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.referrals_your_invites()}
		</div>
		{#if data.referrals.length === 0}
			<p
				class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm
					text-base-content-muted"
			>
				{m.referrals_empty()}
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
								font-bold {entry.status === 'expired' ? 'bg-base-300 text-outline' : 'bg-base-400 text-secondary'}"
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
