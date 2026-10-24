<script lang="ts">
	/** Admin-only view of a helper's vouches, answers included. */
	import { actOnVouch, type AdminVouch } from '$lib/api/admin-approvals';
	import { formatDate } from '$lib/date';
	import VouchActionDialog from '$lib/components/admin/VouchActionDialog.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		vouches: Array<AdminVouch>;
		onchanged: () => Promise<void>;
	}

	let { vouches, onchanged }: Props = $props();

	let acting = $state<{ vouch: AdminVouch; action: 'flag' | 'revoke' } | null>(null);
	let busy = $state(false);

	const counting = $derived(vouches.filter((vouch) => vouch.counts).length);

	async function confirm(reason: string) {
		if (!acting || busy) return;
		busy = true;
		const result = await actOnVouch(acting.vouch.id, acting.action, reason);
		if (result.ok) {
			toast.success(
				acting.action === 'flag'
					? m.admin_requests_vouch_flagged_toast()
					: m.admin_requests_vouch_revoked_toast()
			);
			acting = null;
			await onchanged();
		} else {
			toast.error(m.admin_requests_vouch_changed_toast());
			acting = null;
			await onchanged();
		}
		busy = false;
	}

	const answerLabel = (answer: 'yes' | 'no' | 'unsure'): string =>
		answer === 'yes'
			? m.common_yes()
			: answer === 'no'
				? m.common_no()
				: m.admin_requests_vouch_answer_unsure();

	const statusLabel = (status: AdminVouch['status']): string => {
		switch (status) {
			case 'pending':
				return m.admin_requests_vouch_status_pending();
			case 'accepted':
				return m.admin_requests_vouch_status_accepted();
			case 'declined':
				return m.admin_requests_vouch_status_declined();
			case 'flagged':
				return m.admin_requests_vouch_status_flagged();
			case 'revoked':
				return m.admin_requests_vouch_status_revoked();
			case 'expired':
				return m.admin_requests_vouch_status_expired();
			default:
				return status;
		}
	};
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5">
	<div class="mb-3 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
		{m.admin_requests_vouches_heading({ count: counting })}
	</div>
	{#if vouches.length === 0}
		<p class="py-2 text-[13px] text-base-content-muted">{m.admin_requests_vouches_empty()}</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each vouches as vouch (vouch.id)}
				<div class="rounded-[10px] border border-card-border p-3.5">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-[13.5px] font-semibold text-base-content">{vouch.voucher.name}</span>
						<span class="text-[11.5px] text-outline">
							{vouch.voucher.role === 'family'
								? m.admin_requests_role_family()
								: m.admin_requests_role_helper()} · {vouch.voucher.email}
						</span>
						<span
							class="ml-auto rounded-[5px] bg-base-300 px-2 py-0.5 text-[11px] font-semibold capitalize"
						>
							{vouch.counts
								? m.admin_requests_vouch_status_counts({ status: statusLabel(vouch.status) })
								: statusLabel(vouch.status)}
						</span>
					</div>
					<!-- Standing only matters while it can change the outcome: an accepted
					     vouch stops counting, a pending one won't count once answered. -->
					{#if !vouch.voucher.inGoodStanding && (vouch.status === 'accepted' || vouch.status === 'pending')}
						<p class="mt-1 text-[12px] text-warning">
							{vouch.status === 'accepted'
								? m.admin_requests_vouch_standing_not_counted()
								: m.admin_requests_vouch_standing_wont_count()}
						</p>
					{/if}
					<p class="mt-1 text-[12px] text-base-content-muted">
						{m.admin_requests_vouch_applicant_says({ relationship: vouch.relationship })}
					</p>
					{#if vouch.answers}
						<dl class="mt-2 grid grid-cols-[170px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
							<dt class="text-outline">{m.admin_requests_vouch_how_know()}</dt>
							<dd>{vouch.answers.howKnow}</dd>
							<dt class="text-outline">{m.admin_requests_vouch_known_for()}</dt>
							<dd>{vouch.answers.howLong}</dd>
							<dt class="text-outline">{m.admin_requests_vouch_would_trust()}</dt>
							<dd>{answerLabel(vouch.answers.wouldTrust)}</dd>
							<dt class="text-outline">{m.admin_requests_vouch_concerns()}</dt>
							<dd class={vouch.answers.hasConcerns ? 'font-semibold text-error' : ''}>
								{vouch.answers.hasConcerns
									? m.admin_requests_vouch_concerns_yes({
											detail: vouch.answers.concernsDetail ?? ''
										})
									: m.common_no()}
							</dd>
							<dt class="text-outline">{m.admin_requests_vouch_would_hire()}</dt>
							<dd>{answerLabel(vouch.answers.wouldHire)}</dd>
							{#if vouch.answers.anythingElse}
								<dt class="text-outline">{m.admin_requests_vouch_anything_else()}</dt>
								<dd>{vouch.answers.anythingElse}</dd>
							{/if}
						</dl>
						<p class="mt-2 text-[11px] text-outline">
							{m.admin_requests_vouch_attested({
								date: vouch.attestedAt ? formatDate(vouch.attestedAt) : '—'
							})}
						</p>
					{/if}
					{#if vouch.adminReason}
						<p class="mt-2 text-[12px] text-error">
							<b>{m.admin_requests_vouch_admin_note()}</b>
							{vouch.adminReason}
						</p>
					{/if}
					{#if vouch.status === 'pending' || vouch.status === 'accepted'}
						<div class="mt-2.5 flex gap-2">
							<button
								type="button"
								class="btn btn-outline btn-xs"
								onclick={() => (acting = { vouch, action: 'flag' })}
								>{m.admin_requests_vouch_flag()}</button
							>
							<button
								type="button"
								class="btn btn-outline btn-xs"
								onclick={() => (acting = { vouch, action: 'revoke' })}
								>{m.admin_requests_vouch_revoke()}</button
							>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<VouchActionDialog
	action={acting?.action ?? null}
	voucherName={acting?.vouch.voucher.name ?? ''}
	{busy}
	onconfirm={(reason) => void confirm(reason)}
	oncancel={() => (acting = null)}
/>
