<script lang="ts">
	/** Vouch requests sent to the viewer: vouch (form), decline, or withdraw a
	 * vouch already given while the applicant is still unapproved. */
	import { onMount } from 'svelte';
	import {
		declineVouch,
		listVouchRequests,
		submitVouch,
		withdrawVouch,
		type VouchAnswersInput,
		type VouchRequestEntry
	} from '$lib/api/vouches';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import VouchFormDialog from '$lib/components/vouches/VouchFormDialog.svelte';
	import { initialsOf } from '$lib/initials';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let requests = $state<Array<VouchRequestEntry> | null>(null);
	let loadError = $state('');
	let busy = $state(false);
	let formFor = $state<VouchRequestEntry | null>(null);
	let confirm = $state<{ kind: 'decline' | 'withdraw'; entry: VouchRequestEntry } | null>(null);

	async function load() {
		const result = await listVouchRequests();
		if (result.ok) {
			requests = result.data.requests;
			loadError = '';
		} else {
			loadError = RETRY_MESSAGE;
		}
	}

	onMount(() => {
		void load();
		return notifications.on('vouch.requested', () => void load());
	});

	const errorText = (code: string) =>
		code === 'VOUCH_STATE_INVALID'
			? 'This request was already answered or has expired.'
			: code === 'VOUCH_LOCKED'
				? 'This helper is already approved. Contact Poppynz to change your vouch.'
				: RETRY_MESSAGE;

	async function sendVouch(answers: VouchAnswersInput) {
		if (!formFor || busy) return;
		busy = true;
		const result = await submitVouch(formFor.id, answers);
		if (result.ok) {
			toast.success(`Thanks — your vouch for ${formFor.applicantName} is with our team.`);
			formFor = null;
		} else {
			toast.error(errorText(result.error.code));
		}
		busy = false;
		await load();
	}

	async function confirmAction() {
		if (!confirm || busy) return;
		busy = true;
		const result =
			confirm.kind === 'decline'
				? await declineVouch(confirm.entry.id)
				: await withdrawVouch(confirm.entry.id);
		if (result.ok) {
			toast.success(confirm.kind === 'decline' ? 'Request declined.' : 'Vouch withdrawn.');
		} else {
			toast.error(errorText(result.error.code));
		}
		confirm = null;
		busy = false;
		await load();
	}

	const chip: Record<VouchRequestEntry['status'], { label: string; cls: string }> = {
		pending: { label: 'Waiting for you', cls: 'bg-info-content text-info' },
		accepted: { label: 'Vouched', cls: 'bg-success-content text-success' },
		declined: { label: 'Declined', cls: 'bg-base-300 text-base-content-muted' },
		expired: { label: 'Expired', cls: 'bg-base-300 text-base-content-muted' },
		// The API already folds admin flags/revokes and the voucher's own
		// withdrawal into "closed": the voucher never learns of an admin action.
		closed: { label: 'Closed', cls: 'bg-base-300 text-base-content-muted' }
	};
</script>

<svelte:head>
	<title>Vouch requests · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Vouch requests</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		Helpers applying to Poppynz can ask members who know them to vouch. Only vouch for people you
		know personally.
	</p>

	{#if loadError}
		<p role="alert" class="text-sm font-medium text-error">{loadError}</p>
	{:else if requests === null}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if requests.length === 0}
		<p
			class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm text-base-content-muted"
		>
			No vouch requests yet.
		</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each requests as entry (entry.id)}
				<div
					class="flex flex-wrap items-center gap-3 rounded-[10px] border border-card-border bg-base-100 px-4 py-3.5"
				>
					{#if entry.applicantImage}
						<img src={entry.applicantImage} alt="" class="size-10 rounded-full object-cover" />
					{:else}
						<span
							class="flex size-10 items-center justify-center rounded-full bg-base-400 text-[13px] font-bold text-secondary"
						>
							{initialsOf(entry.applicantName)}
						</span>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-[13.5px] font-semibold text-base-content">
							{entry.applicantName}
						</div>
						<div class="truncate text-[12px] text-base-content-muted">"{entry.relationship}"</div>
					</div>
					<span
						class="rounded-[5px] px-2.5 py-1 text-[11px] font-semibold {chip[entry.status].cls}"
					>
						{chip[entry.status].label}
					</span>
					{#if entry.status === 'pending'}
						<button type="button" class="btn btn-primary btn-sm" onclick={() => (formFor = entry)}
							>Vouch</button
						>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onclick={() => (confirm = { kind: 'decline', entry })}
						>
							Decline
						</button>
					{:else if entry.canWithdraw}
						<!-- Accepted and the applicant isn't approved yet; after approval the
						     vouch is locked server-side (VOUCH_LOCKED), so no button. -->
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onclick={() => (confirm = { kind: 'withdraw', entry })}
						>
							Withdraw
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<VouchFormDialog
	open={formFor !== null}
	applicantName={formFor?.applicantName ?? ''}
	{busy}
	onconfirm={(answers) => void sendVouch(answers)}
	oncancel={() => (formFor = null)}
/>

<ConfirmDialog
	open={confirm !== null}
	title={confirm?.kind === 'decline' ? 'Decline this request?' : 'Withdraw your vouch?'}
	body={confirm?.kind === 'decline'
		? `${confirm.entry.applicantName} will see that you declined. No reason is shared.`
		: `Your vouch for ${confirm?.entry.applicantName ?? ''} will stop counting.`}
	confirmLabel={confirm?.kind === 'decline' ? 'Decline' : 'Withdraw'}
	{busy}
	onconfirm={() => void confirmAction()}
	oncancel={() => (confirm = null)}
/>
