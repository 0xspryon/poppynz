<script lang="ts">
	/** One session's resolution and the actions the viewer may take on it now
	 * (Tier 3, spec §10) — exactly the ones the API offers. Each action opens
	 * a confirmation that states the outcome first (how it is classified and
	 * who is affected; no amounts in step 1), then toasts what came of it. */
	import {
		recordSessionAction,
		respondToSession,
		type ContractCycleDetail,
		type ContractCycleSession,
		type SessionAction,
		type SessionReasonCode,
		type SessionResponse
	} from '$lib/api/contracts';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import {
		noticeHoursText,
		resolutionKindLabel,
		sessionActionErrorMessage,
		sessionReasonLabel,
		sessionReasons
	} from '$lib/session-resolution';
	import { toast } from '$lib/toast.svelte';
	import SessionResolutionSummary from './SessionResolutionSummary.svelte';

	interface Props {
		session: ContractCycleSession;
		cycle: ContractCycleDetail;
		/** Refetch after a change. */
		onchanged?: () => void;
	}

	let { session, cycle, onchanged }: Props = $props();

	type Pending =
		| { kind: 'action'; action: SessionAction }
		| { kind: 'response'; response: SessionResponse };

	let pending = $state<Pending | null>(null);
	let busy = $state(false);
	let reason = $state<SessionReasonCode | ''>('');
	let note = $state('');
	// A number input binds a number, or null once cleared; '' before typing.
	let minutesWorked = $state<number | string | null>('');

	const isFamily = $derived(cycle.viewerSide === 'family');
	const name = $derived(cycle.counterpartName);
	const resolution = $derived(session.resolution);
	const active = $derived(
		resolution !== null &&
			(resolution.status === 'proposed' ||
				resolution.status === 'confirmed' ||
				resolution.status === 'contested' ||
				resolution.status === 'decided')
	);
	const isDayOff = $derived(resolution?.kind === 'day_off_agreed');

	const actionLabel = (action: SessionAction): string => {
		switch (action) {
			case 'cancel':
				return m.sessions_action_cancel();
			case 'propose_day_off':
				return m.sessions_action_day_off();
			case 'report_no_show':
				return m.sessions_action_no_show();
			case 'report_reduced_hours':
				return m.sessions_action_reduced_hours();
			case 'dispute':
				return m.sessions_action_dispute();
		}
	};

	const responseLabel = (response: SessionResponse): string =>
		response === 'accept'
			? m.sessions_respond_accept()
			: response === 'contest'
				? m.sessions_respond_contest()
				: m.sessions_respond_decline();

	const hours = $derived(cycle.sessionWindow.reportResponseHours);
	const notice = $derived(noticeHoursText(cycle.sessionWindow.cancellationNoticeHours));

	/** The dialog's title and the outcome it states before confirming. */
	const dialog = $derived.by(() => {
		if (pending === null) return null;
		if (pending.kind === 'response') {
			switch (pending.response) {
				case 'accept':
					return {
						title: isDayOff
							? m.sessions_confirm_accept_day_off_title()
							: m.sessions_confirm_accept_title(),
						body:
							isDayOff && resolution?.countsAs
								? m.sessions_confirm_accept_day_off({
										kind: resolutionKindLabel(resolution.countsAs)
									})
								: m.sessions_confirm_accept({
										kind: resolution ? resolutionKindLabel(resolution.kind) : ''
									})
					};
				case 'contest':
					return { title: m.sessions_confirm_contest_title(), body: m.sessions_confirm_contest() };
				case 'decline':
					return {
						title: m.sessions_confirm_decline_title(),
						body: m.sessions_confirm_decline({ name })
					};
			}
		}
		switch (pending.action) {
			case 'cancel':
				return {
					title: m.sessions_confirm_cancel_title(),
					body:
						session.cancelOutcome === 'family_cancelled_early'
							? m.sessions_confirm_cancel_early({ notice, name })
							: session.cancelOutcome === 'family_cancelled_late'
								? m.sessions_confirm_cancel_late({ notice, name })
								: m.sessions_confirm_cancel_helper({ name })
				};
			case 'propose_day_off': {
				const when = session.cutoffAt ? formatDateTime(session.cutoffAt) : '';
				return {
					title: m.sessions_confirm_day_off_title(),
					body: isFamily
						? m.sessions_confirm_day_off_family({ name, when })
						: m.sessions_confirm_day_off_helper({ name, when })
				};
			}
			case 'report_no_show':
				return {
					title: m.sessions_confirm_no_show_title(),
					body: isFamily
						? m.sessions_confirm_no_show_family({ name, hours })
						: m.sessions_confirm_no_show_helper({ name, hours })
				};
			case 'report_reduced_hours':
				return {
					title: m.sessions_confirm_reduced_hours_title(),
					body: m.sessions_confirm_reduced_hours({ name, hours })
				};
			case 'dispute':
				return {
					title: m.sessions_confirm_dispute_title(),
					body:
						active && resolution
							? m.sessions_confirm_dispute_existing({
									kind: resolutionKindLabel(resolution.kind)
								})
							: m.sessions_confirm_dispute_new()
				};
		}
	});

	const asksReason = $derived(
		pending?.kind === 'action' &&
			(pending.action === 'cancel' || pending.action === 'propose_day_off')
	);
	const asksMinutes = $derived(
		pending?.kind === 'action' && pending.action === 'report_reduced_hours'
	);
	const isStatement = $derived(
		(pending?.kind === 'action' && pending.action === 'dispute') ||
			(pending?.kind === 'response' && pending.response === 'contest')
	);

	function open(next: Pending) {
		pending = next;
		reason = '';
		note = '';
		minutesWorked = '';
	}

	const successMessage = (done: Pending): string => {
		if (done.kind === 'response') {
			return done.response === 'accept'
				? m.sessions_toast_accepted()
				: done.response === 'contest'
					? m.sessions_toast_contested()
					: m.sessions_toast_declined({ name });
		}
		switch (done.action) {
			case 'cancel':
				return m.sessions_toast_cancelled({ name });
			case 'propose_day_off':
				return m.sessions_toast_day_off({ name });
			case 'report_no_show':
			case 'report_reduced_hours':
				return m.sessions_toast_reported({ name });
			case 'dispute':
				return m.sessions_toast_disputed();
		}
	};

	async function confirm() {
		if (pending === null || busy) return;
		const done = pending;
		if (asksMinutes) {
			// Number('') and Number(null) are 0: an empty field is not "0 worked".
			const minutes =
				minutesWorked === null || String(minutesWorked).trim() === ''
					? Number.NaN
					: Number(minutesWorked);
			if (!Number.isInteger(minutes) || minutes < 0 || minutes >= session.elapsedMinutes) {
				toast.error(m.sessions_error_invalid_minutes());
				return;
			}
		}
		busy = true;
		const result =
			done.kind === 'response'
				? await respondToSession(cycle.contractId, session.id, {
						response: done.response,
						note: note.trim() || null
					})
				: await recordSessionAction(cycle.contractId, session.id, {
						action: done.action,
						reason: reason || null,
						note: note.trim() || null,
						minutesWorked: asksMinutes ? Number(minutesWorked) : null
					});
		busy = false;
		pending = null;
		if (result.ok) {
			toast.success(successMessage(done));
		} else {
			toast.error(sessionActionErrorMessage(result.error));
		}
		onchanged?.();
	}
</script>

<div class="flex flex-col gap-2" data-testid="session-actions">
	{#if resolution}
		<SessionResolutionSummary
			{resolution}
			counterpartName={name}
			elapsedMinutes={session.elapsedMinutes}
		/>
	{/if}

	{#if session.responses.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each session.responses as response (response)}
				<button
					type="button"
					class={['btn btn-xs', response === 'accept' ? 'btn-primary' : 'btn-outline']}
					onclick={() => open({ kind: 'response', response })}
					data-testid={`session-respond-${response}`}
				>
					{responseLabel(response)}
				</button>
			{/each}
		</div>
	{/if}

	{#if session.actions.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each session.actions as action (action)}
				<button
					type="button"
					class={['btn btn-ghost btn-xs', action === 'cancel' ? 'text-error' : 'text-secondary']}
					onclick={() => open({ kind: 'action', action })}
					data-testid={`session-action-${action}`}
				>
					{actionLabel(action)}
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if dialog}
	<ConfirmDialog
		open={pending !== null}
		title={dialog.title}
		body={dialog.body}
		confirmLabel={m.common_confirm()}
		confirmClass={pending?.kind === 'action' && pending.action === 'cancel'
			? 'btn-error'
			: 'btn-primary'}
		{busy}
		onconfirm={() => void confirm()}
		oncancel={() => (pending = null)}
	>
		<div class="flex flex-col gap-3">
			{#if asksReason}
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-semibold text-base-content">{m.sessions_field_reason()}</span>
					<select class="select select-sm w-full" bind:value={reason} data-testid="session-reason">
						<option value="">{m.sessions_field_reason_none()}</option>
						{#each sessionReasons as code (code)}
							<option value={code}>{sessionReasonLabel(code)}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if asksMinutes}
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-semibold text-base-content">
						{m.sessions_field_minutes({ total: session.elapsedMinutes })}
					</span>
					<input
						type="number"
						min="0"
						max={session.elapsedMinutes - 1}
						step="1"
						class="input input-sm w-full"
						bind:value={minutesWorked}
						data-testid="session-minutes"
					/>
				</label>
			{/if}
			<label class="flex flex-col gap-1 text-[12.5px]">
				<span class="font-semibold text-base-content">
					{isStatement ? m.sessions_field_statement() : m.sessions_field_note()}
				</span>
				<textarea
					class="textarea textarea-sm w-full"
					rows="3"
					maxlength="1000"
					bind:value={note}
					data-testid="session-note"
				></textarea>
			</label>
		</div>
	</ConfirmDialog>
{/if}
