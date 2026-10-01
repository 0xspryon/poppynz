<script lang="ts">
	/** Admin-only view of a helper's vouches, answers included. */
	import { actOnVouch, type AdminVouch } from '$lib/api/admin-approvals';
	import { formatDate } from '$lib/date';
	import VouchActionDialog from '$lib/components/admin/VouchActionDialog.svelte';
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
			toast.success(acting.action === 'flag' ? 'Vouch flagged.' : 'Vouch revoked.');
			acting = null;
			await onchanged();
		} else {
			toast.error('That vouch has already changed — reloading.');
			acting = null;
			await onchanged();
		}
		busy = false;
	}

	const answerLabel = { yes: 'Yes', no: 'No', unsure: 'Not sure' } as const;
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5">
	<div class="mb-3 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
		Vouches · {counting} of 2 recommended
	</div>
	{#if vouches.length === 0}
		<p class="py-2 text-[13px] text-base-content-muted">No vouch requests yet — arrange a chat.</p>
	{:else}
		<div class="flex flex-col gap-3">
			{#each vouches as vouch (vouch.id)}
				<div class="rounded-[10px] border border-card-border p-3.5">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-[13.5px] font-semibold text-base-content">{vouch.voucher.name}</span>
						<span class="text-[11.5px] text-outline">
							{vouch.voucher.role === 'family' ? 'Family' : 'Helper'} · {vouch.voucher.email}
						</span>
						<span
							class="ml-auto rounded-[5px] bg-base-300 px-2 py-0.5 text-[11px] font-semibold capitalize"
						>
							{vouch.status}{vouch.counts ? ' · counts' : ''}
						</span>
					</div>
					{#if !vouch.voucher.inGoodStanding}
						<p class="mt-1 text-[12px] text-warning">
							Voucher is no longer approved or is banned — not counted.
						</p>
					{/if}
					<p class="mt-1 text-[12px] text-base-content-muted">
						Applicant says: "{vouch.relationship}"
					</p>
					{#if vouch.answers}
						<dl class="mt-2 grid grid-cols-[170px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
							<dt class="text-outline">How they know them</dt>
							<dd>{vouch.answers.howKnow}</dd>
							<dt class="text-outline">Known for</dt>
							<dd>{vouch.answers.howLong}</dd>
							<dt class="text-outline">Would trust with care</dt>
							<dd>{answerLabel[vouch.answers.wouldTrust]}</dd>
							<dt class="text-outline">Concerns</dt>
							<dd class={vouch.answers.hasConcerns ? 'font-semibold text-error' : ''}>
								{vouch.answers.hasConcerns ? `Yes — ${vouch.answers.concernsDetail ?? ''}` : 'No'}
							</dd>
							<dt class="text-outline">Would hire / recommend</dt>
							<dd>{answerLabel[vouch.answers.wouldHire]}</dd>
							{#if vouch.answers.anythingElse}
								<dt class="text-outline">Anything else</dt>
								<dd>{vouch.answers.anythingElse}</dd>
							{/if}
						</dl>
						<p class="mt-2 text-[11px] text-outline">
							Attested {vouch.attestedAt ? formatDate(vouch.attestedAt) : '—'} · IP (client-reported)
							{vouch.submittedIp ?? 'unknown'}
						</p>
					{/if}
					{#if vouch.adminReason}
						<p class="mt-2 text-[12px] text-error"><b>Admin note:</b> {vouch.adminReason}</p>
					{/if}
					{#if vouch.status === 'pending' || vouch.status === 'accepted'}
						<div class="mt-2.5 flex gap-2">
							<button
								type="button"
								class="btn btn-outline btn-xs"
								onclick={() => (acting = { vouch, action: 'flag' })}>Flag</button
							>
							<button
								type="button"
								class="btn btn-outline btn-xs"
								onclick={() => (acting = { vouch, action: 'revoke' })}>Revoke</button
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
