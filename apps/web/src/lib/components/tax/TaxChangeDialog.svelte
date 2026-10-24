<script lang="ts" module>
	export type EffectiveDraft = {
		effectiveFrom: string;
		effectiveTo: string | null;
		reason: string;
		confirmPastEffectiveDate: boolean;
	};
</script>

<script lang="ts">
	/** Every tax-configuration change, in two steps: the new value (the
	 * caller's fields), its start date and the mandatory reason; then a
	 * review that says what the change does — it supersedes the value in
	 * force from that date, applies to quotes made from then on, and never
	 * touches a charge already made. A start date already past needs an
	 * explicit tick. */
	import type { Snippet } from 'svelte';
	import { formatDate } from '$lib/date';

	interface Props {
		open: boolean;
		title: string;
		/** Today in the tax calendar (from the API). */
		today: string;
		/** The caller's fields are valid. */
		valid: boolean;
		/** One line describing the new value, for the review step. */
		summary: string;
		busy?: boolean;
		/** The caller's fields. */
		children: Snippet;
		onsave: (draft: EffectiveDraft) => void;
		oncancel: () => void;
	}

	let {
		open,
		title,
		today,
		valid,
		summary,
		busy = false,
		children,
		onsave,
		oncancel
	}: Props = $props();

	let step = $state<'edit' | 'review'>('edit');
	let effectiveFrom = $state('');
	let effectiveTo = $state('');
	let reason = $state('');
	let confirmPast = $state(false);

	$effect(() => {
		if (open) {
			step = 'edit';
			effectiveFrom = today;
			effectiveTo = '';
			reason = '';
			confirmPast = false;
		}
	});

	const isPast = $derived(effectiveFrom !== '' && effectiveFrom < today);
	const rangeOk = $derived(effectiveTo === '' || effectiveTo > effectiveFrom);
	const canReview = $derived(valid && effectiveFrom !== '' && rangeOk && reason.trim().length > 0);
	const canSave = $derived(canReview && (!isPast || confirmPast));

	function review(event: SubmitEvent) {
		event.preventDefault();
		if (canReview) step = 'review';
	}

	function save() {
		if (busy || !canSave) return;
		onsave({
			effectiveFrom,
			effectiveTo: effectiveTo === '' ? null : effectiveTo,
			reason: reason.trim(),
			confirmPastEffectiveDate: isPast && confirmPast
		});
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-box max-w-xl border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">{title}</h3>

			{#if step === 'edit'}
				<form class="mt-4 flex flex-col gap-4" onsubmit={review}>
					{@render children()}

					<div class="grid gap-4 sm:grid-cols-2">
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium text-base-content">Effective from</span>
							<input
								type="date"
								class="input input-bordered w-full"
								bind:value={effectiveFrom}
								required
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium text-base-content">
								Until <span class="font-normal text-outline">(optional)</span>
							</span>
							<input type="date" class="input input-bordered w-full" bind:value={effectiveTo} />
							{#if !rangeOk}
								<span class="text-xs text-error">The end must be after the start.</span>
							{/if}
						</label>
					</div>

					<label class="flex flex-col gap-1">
						<span class="text-sm font-medium text-base-content">Reason for the change</span>
						<textarea
							class="textarea textarea-bordered w-full"
							rows="2"
							maxlength="500"
							placeholder="e.g. Budget 2026: HST rises to 13.5% from 1 January"
							bind:value={reason}
							required
						></textarea>
						<span class="text-xs text-outline">Kept in the audit log with your name.</span>
					</label>

					<div class="modal-action">
						<button type="button" class="btn btn-ghost" onclick={oncancel}>Cancel</button>
						<button type="submit" class="btn btn-primary" disabled={!canReview}>
							Review change
						</button>
					</div>
				</form>
			{:else}
				<div class="mt-3 flex flex-col gap-3 text-sm">
					<p class="font-medium text-base-content">{summary}</p>
					<p class="text-base-content-muted">
						From {formatDate(effectiveFrom)}{effectiveTo
							? ` until ${formatDate(effectiveTo)}`
							: ''}. The value in force on that date is closed there and kept in the history.
					</p>
					<p class="rounded-md bg-base-200 px-3 py-2 text-base-content-muted">
						Applies to quotes made from now on. Charges already made keep the tax lines frozen on
						them and never change.
					</p>
					<p class="text-base-content-muted">Reason: “{reason.trim()}”</p>
					{#if isPast}
						<label class="flex items-start gap-2 rounded-md border border-warning/40 px-3 py-2">
							<input
								type="checkbox"
								class="checkbox checkbox-sm mt-0.5"
								bind:checked={confirmPast}
							/>
							<span class="text-base-content">
								{formatDate(effectiveFrom)} is already past. I confirm the change applies from that date.
							</span>
						</label>
					{/if}
				</div>
				<div class="modal-action">
					<button
						type="button"
						class="btn btn-ghost"
						onclick={() => (step = 'edit')}
						disabled={busy}
					>
						Back
					</button>
					<button type="button" class="btn btn-primary" onclick={save} disabled={busy || !canSave}>
						{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
						Save change
					</button>
				</div>
			{/if}
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={oncancel}
			disabled={busy}
			aria-label="Close"
		></button>
	</div>
{/if}
