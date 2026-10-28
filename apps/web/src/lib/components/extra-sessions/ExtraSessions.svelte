<script lang="ts">
	/** A cycle's extra sessions (Tier 3 step 3): each one's state and what the
	 * viewer may do with it now — confirm (the family ticking "I authorise
	 * Poppynz to charge my card $X"), decline, withdraw its own proposal, or
	 * cancel it for free during the charge delay — and "Add an extra session".
	 * A cycle with nothing to bill invites "Add a session that took place".
	 * Every outcome is a toast. */
	import { resolve } from '$app/paths';
	import {
		cancelExtraSession,
		listExtraSessions,
		respondToExtraSession,
		withdrawExtraSession,
		type ExtraSession,
		type ExtraSessionAction,
		type ExtraSessionsData
	} from '$lib/api/extra-sessions';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import {
		delayText,
		extraSessionChip,
		extraSessionErrorMessage,
		extraSessionLabel,
		extraSessionStateText,
		proposeBlockedText
	} from '$lib/extra-sessions';
	import { formatMoney } from '$lib/money';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { onMount } from 'svelte';
	import ProposeExtraSessionDialog from './ProposeExtraSessionDialog.svelte';

	interface Props {
		contractId: string;
		cycleId: string;
		/** The cycle's status: one with nothing to bill invites a session that
		 * took place. */
		cycleStatus: string;
		/** The cycle's first day, the propose dialog's starting date. */
		cycleStartsOn: string;
		counterpartName: string;
		/** Refetch the cycle after a change. */
		onchanged?: () => void;
	}

	let { contractId, cycleId, cycleStatus, cycleStartsOn, counterpartName, onchanged }: Props =
		$props();

	let data = $state<ExtraSessionsData | null>(null);
	let proposing = $state(false);
	let pending = $state<{ row: ExtraSession; action: ExtraSessionAction } | null>(null);
	let authorised = $state(false);
	let busy = $state(false);

	let seq = 0;
	async function load() {
		seq += 1;
		const mine = seq;
		const result = await listExtraSessions(contractId, cycleId);
		if (mine !== seq) return;
		data = result.ok ? result.data : null;
	}

	$effect(() => {
		void contractId;
		void cycleId;
		void load();
	});

	onMount(() =>
		notifications.on('contract.extra_session', (event) => {
			if (event.payload.contractId === contractId) void load();
		})
	);

	const facts = $derived(data?.propose ?? null);
	const policy = $derived(data?.policy ?? null);
	const side = $derived(facts?.viewerSide ?? 'family');
	const rows = $derived(data?.extraSessions ?? []);
	const nothingToBill = $derived(cycleStatus === 'empty');
	const blocked = $derived(facts && !facts.canPropose ? proposeBlockedText(facts.refusal) : null);
	/** The dialog opens on the cycle's first day when it is open, else the
	 * last open day. */
	const initialDate = $derived(
		facts?.firstDate &&
			facts.lastDate &&
			cycleStartsOn >= facts.firstDate &&
			cycleStartsOn <= facts.lastDate
			? cycleStartsOn
			: (facts?.lastDate ?? null)
	);

	const actionLabel = (action: ExtraSessionAction) =>
		action === 'accept'
			? m.extra_sessions_action_accept()
			: action === 'decline'
				? m.extra_sessions_action_decline()
				: action === 'withdraw'
					? m.extra_sessions_action_withdraw()
					: m.extra_sessions_action_cancel();

	const delay = $derived(policy ? delayText(policy.chargeDelayMinutes) : '');

	const dialog = $derived.by(() => {
		if (pending === null) return null;
		const name = counterpartName;
		switch (pending.action) {
			case 'accept':
				return {
					title: m.extra_sessions_confirm_accept_title(),
					body:
						side === 'family'
							? m.extra_sessions_confirm_accept_family({
									name,
									session: extraSessionLabel(pending.row),
									delay
								})
							: m.extra_sessions_confirm_accept_helper({
									name,
									session: extraSessionLabel(pending.row),
									delay
								})
				};
			case 'decline':
				return {
					title: m.extra_sessions_confirm_decline_title(),
					body: m.extra_sessions_confirm_decline({ name })
				};
			case 'withdraw':
				return {
					title: m.extra_sessions_confirm_withdraw_title(),
					body: m.extra_sessions_confirm_withdraw({ name })
				};
			case 'cancel':
				return {
					title: m.extra_sessions_confirm_cancel_title(),
					body: m.extra_sessions_confirm_cancel({ name })
				};
		}
	});

	const needsAuthorisation = $derived(
		pending?.action === 'accept' && side === 'family' && pending.row.authoriseCents !== null
	);

	function open(row: ExtraSession, action: ExtraSessionAction) {
		pending = { row, action };
		authorised = false;
	}

	async function confirm() {
		if (pending === null || busy) return;
		if (needsAuthorisation && !authorised) {
			toast.error(m.extra_sessions_error_authorisation_required());
			return;
		}
		const { row, action } = pending;
		busy = true;
		const result =
			action === 'accept' || action === 'decline'
				? await respondToExtraSession(contractId, row.id, {
						response: action,
						authorisedCents: side === 'family' && action === 'accept' ? row.authoriseCents : null
					})
				: action === 'withdraw'
					? await withdrawExtraSession(contractId, row.id)
					: await cancelExtraSession(contractId, row.id);
		busy = false;
		pending = null;
		if (!result.ok) {
			toast.error(extraSessionErrorMessage(result.error, { minMinutes: policy?.minMinutes }));
		} else if (action === 'accept') {
			// The family is told what it will be charged, and when.
			if (side === 'family') {
				toast.success(
					m.extra_sessions_toast_charge_soon({
						amount: formatMoney(row.authoriseCents ?? row.familyTotalCents ?? 0),
						delay
					})
				);
			} else {
				toast.success(m.extra_sessions_toast_confirmed_helper({ delay }));
			}
		} else if (action === 'decline') {
			toast.success(m.extra_sessions_toast_declined({ name: counterpartName }));
		} else if (action === 'withdraw') {
			toast.success(m.extra_sessions_toast_withdrawn({ name: counterpartName }));
		} else {
			toast.success(m.extra_sessions_toast_cancelled());
		}
		void load();
		onchanged?.();
	}
</script>

{#if data}
	<div class="mt-4 border-t border-base-300 pt-3" data-testid="extra-sessions">
		<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
			<h3 class="flex-1 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
				{m.extra_sessions_heading()}
			</h3>
			{#if facts?.canPropose && !nothingToBill}
				<button
					type="button"
					class="btn btn-outline btn-xs btn-primary"
					onclick={() => (proposing = true)}
					data-testid="extra-session-add"
				>
					<i class="las la-plus" aria-hidden="true"></i>
					{m.extra_sessions_add()}
				</button>
			{/if}
		</div>

		{#if nothingToBill && facts?.canPropose}
			<!-- "Nothing to bill": a session that took place anyway is added here. -->
			<div
				class="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3"
				data-testid="extra-session-invite"
			>
				<p class="min-w-0 flex-1 text-[12.5px] leading-relaxed text-base-content">
					{m.extra_sessions_empty_invite()}
				</p>
				<button
					type="button"
					class="btn btn-sm btn-primary"
					onclick={() => (proposing = true)}
					data-testid="extra-session-add-past"
				>
					<i class="las la-plus" aria-hidden="true"></i>
					{m.extra_sessions_add_past()}
				</button>
			</div>
		{/if}

		{#if policy && facts?.canPropose}
			<p class="mb-2 text-[11.5px] leading-relaxed text-outline">
				{m.extra_sessions_intro({ days: policy.lookbackDays, name: counterpartName })}
			</p>
		{:else if blocked}
			<p class="mb-2 text-[11.5px] text-outline" data-testid="extra-session-blocked">{blocked}</p>
		{/if}

		{#if rows.length === 0}
			<p class="text-[12.5px] text-base-content-muted">{m.extra_sessions_none()}</p>
		{:else}
			<ul class="divide-y divide-base-300">
				{#each rows as row (row.id)}
					{@const chip = extraSessionChip(row)}
					<li class="flex flex-col gap-1.5 py-2.5 text-[13px]" data-testid="extra-session-row">
						<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
							<span class="min-w-0 flex-1 font-medium text-base-content">
								{extraSessionLabel(row)}
							</span>
							<StatusChip status={chip.status} label={chip.label} />
						</div>
						<p class="text-[11.5px] text-outline">
							{row.proposedByMe
								? m.extra_sessions_proposed_by_me()
								: m.extra_sessions_proposed_by({ name: counterpartName })}
							{#if side === 'family' && row.familyTotalCents !== null}
								· {m.extra_sessions_amount_family({ amount: formatMoney(row.familyTotalCents) })}
							{:else if side === 'helper' && row.helperShareCents !== null}
								· {m.extra_sessions_amount_helper({ amount: formatMoney(row.helperShareCents) })}
							{/if}
						</p>
						<p
							class="text-[12.5px] leading-relaxed text-base-content-muted"
							data-testid="extra-session-state"
						>
							{extraSessionStateText(row, side, counterpartName)}
							{#if side === 'family' && row.status === 'charge_failed'}
								<a class="link font-semibold link-primary" href={resolve('/family/billing')}>
									{m.extra_sessions_update_card()}
								</a>
							{/if}
						</p>
						{#if row.note}
							<p class="text-[12px] text-base-content-muted italic">“{row.note}”</p>
						{/if}
						{#if row.actions.length > 0}
							<div class="flex flex-wrap gap-1.5">
								{#each row.actions as action (action)}
									<button
										type="button"
										class={[
											'btn btn-xs',
											action === 'accept'
												? 'btn-primary'
												: action === 'cancel'
													? 'btn-ghost text-error'
													: 'btn-outline'
										]}
										onclick={() => open(row, action)}
										data-testid={`extra-session-${action}`}
									>
										{actionLabel(action)}
									</button>
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if facts && policy}
		<ProposeExtraSessionDialog
			open={proposing}
			{contractId}
			{facts}
			{policy}
			{counterpartName}
			{initialDate}
			onclose={() => (proposing = false)}
			onproposed={() => {
				void load();
				onchanged?.();
			}}
		/>
	{/if}

	{#if dialog}
		<ConfirmDialog
			open={pending !== null}
			title={dialog.title}
			body={dialog.body}
			confirmLabel={m.common_confirm()}
			cancelLabel={m.common_back()}
			confirmClass={pending?.action === 'accept' ? 'btn-primary' : 'btn-error'}
			{busy}
			onconfirm={() => void confirm()}
			oncancel={() => (pending = null)}
		>
			{#if needsAuthorisation && pending}
				<label class="flex items-start gap-2 text-[12.5px]" data-testid="extra-session-authorise">
					<input
						type="checkbox"
						class="checkbox mt-0.5 checkbox-sm checkbox-primary"
						bind:checked={authorised}
					/>
					<span>
						<span class="font-semibold text-base-content">
							{m.extra_sessions_authorise({
								amount: formatMoney(pending.row.authoriseCents ?? 0)
							})}
						</span>
						<span class="block text-[11.5px] text-base-content-muted">
							{m.extra_sessions_authorise_hint()}
						</span>
					</span>
				</label>
			{/if}
		</ConfirmDialog>
	{/if}
{/if}
