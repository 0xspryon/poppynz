<script lang="ts">
	/** Admin-only free text on the approval request — typically notes from
	 * an off-app chat. Never shown to the applicant. */
	import { saveGeneralRemarks } from '$lib/api/admin-approvals';
	import { formatDateTime } from '$lib/date';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		requestId: string;
		remarks: string | null;
		updatedAt: string | null;
		onchanged: () => Promise<void>;
	}

	let { requestId, remarks, updatedAt, onchanged }: Props = $props();

	let draft = $derived(remarks ?? '');
	let saving = $state(false);

	const dirty = $derived(draft.trim() !== (remarks ?? '').trim());

	async function save() {
		if (!dirty || saving) return;
		saving = true;
		const result = await saveGeneralRemarks(requestId, draft);
		if (result.ok) {
			toast.success('Remarks saved.');
			await onchanged();
		} else {
			toast.error('Remarks could not be saved. Please try again.');
		}
		saving = false;
	}
</script>

<div class="rounded-lg border border-card-border bg-base-100 p-5">
	<label class="fieldset">
		<span class="mb-1 text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase"
			>General remarks</span
		>
		<textarea
			class="textarea min-h-28 w-full"
			maxlength="5000"
			placeholder="Notes from the interview"
			bind:value={draft}
		></textarea>
	</label>
	<div class="mt-2 flex items-center justify-between gap-2">
		<span class="text-xs text-outline">
			{updatedAt ? `Last saved ${formatDateTime(updatedAt)}` : 'Only admins see this.'}
		</span>
		<button
			type="button"
			class="btn btn-primary btn-sm"
			disabled={!dirty || saving}
			onclick={() => void save()}
		>
			{#if saving}<span class="loading loading-spinner loading-xs"></span>{/if}
			Save
		</button>
	</div>
</div>
