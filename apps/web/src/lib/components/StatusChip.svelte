<script lang="ts" module>
	export type ChipStatus =
		| 'approved'
		| 'complete'
		| 'submitted'
		| 'rejected'
		| 'missing'
		| 'empty'
		| 'expired'
		| 'in-progress';
</script>

<script lang="ts">
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
		'in-progress': 'bg-credibled-tint text-credibled-text'
	};

	const defaultLabels: Record<ChipStatus, string> = {
		approved: 'Approved',
		complete: 'Complete',
		submitted: 'Submitted',
		rejected: 'Rejected',
		missing: 'Missing',
		empty: 'Empty',
		expired: 'Expired',
		'in-progress': 'In progress'
	};
</script>

<span
	class="rounded-sm px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap {styles[status]}"
>
	{label ?? defaultLabels[status]}
</span>
