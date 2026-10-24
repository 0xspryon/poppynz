<script lang="ts" module>
	export type ChipStatus =
		| 'approved'
		| 'complete'
		| 'submitted'
		| 'rejected'
		| 'missing'
		| 'empty'
		| 'expired'
		| 'in-progress'
		// Contract lifecycle (16e/16f pills).
		| 'draft'
		| 'proposed'
		| 'awaiting-you'
		| 'changes-requested'
		| 'active'
		| 'declined'
		| 'ending'
		| 'ended'
		// Billing paused on an active contract (B5).
		| 'suspended';
</script>

<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	/** Small status chip (design: 11px/600, 5px radius, soft tint background).
	 * Colors follow the semantic mapping in app.css — soft chips pair a status
	 * color with its `-content` tint. `in-progress` is Credibled-scoped. */
	interface Props {
		status: ChipStatus;
		/** Override the default label derived from the status. */
		label?: string;
	}

	let { status, label }: Props = $props();

	const styles: Record<ChipStatus, string> = {
		approved: 'bg-success-content text-success',
		complete: 'bg-success-content text-success',
		submitted: 'bg-info-content text-info',
		rejected: 'bg-error-content text-error',
		missing: 'bg-warning-content text-warning',
		empty: 'bg-base-300 text-base-content-muted',
		expired: 'bg-base-300 text-base-content-muted',
		'in-progress': 'bg-credibled-tint text-credibled-text',
		draft: 'bg-base-300 text-base-content-muted',
		proposed: 'bg-info-content text-info',
		'awaiting-you': 'bg-accent/15 text-accent',
		'changes-requested': 'bg-warning-content text-warning',
		active: 'bg-success-content text-success',
		declined: 'bg-error-content text-error',
		ending: 'bg-warning-content text-warning',
		ended: 'bg-base-300 text-base-content-muted',
		suspended: 'bg-warning-content text-warning'
	};

	const defaultLabels: Record<ChipStatus, () => string> = {
		approved: m.shell_status_approved,
		complete: m.shell_status_complete,
		submitted: m.shell_status_submitted,
		rejected: m.shell_status_rejected,
		missing: m.shell_status_missing,
		empty: m.shell_status_empty,
		expired: m.shell_status_expired,
		'in-progress': m.shell_status_in_progress,
		draft: m.shell_status_draft,
		proposed: m.shell_status_proposed,
		'awaiting-you': m.shell_status_awaiting_you,
		'changes-requested': m.shell_status_changes_requested,
		active: m.shell_status_active,
		declined: m.shell_status_declined,
		ending: m.shell_status_ending,
		ended: m.shell_status_ended,
		suspended: m.shell_status_suspended
	};
</script>

<span class="rounded-sm px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap {styles[status]}">
	{label ?? defaultLabels[status]()}
</span>
