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
	import { m } from '$lib/paraglide/messages';

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
							<span class="text-sm font-medium text-base-content"
								>{m.tax_change_effective_from()}</span
							>
							<input
								type="date"
								class="input input-bordered w-full"
								bind:value={effectiveFrom}
								required
							/>
						</label>
						<label class="flex flex-col gap-1">
							<span class="text-sm font-medium text-base-content">
								{m.tax_change_until()}
								<span class="font-normal text-outline">{m.tax_change_optional_hint()}</span>
							</span>
							<input type="date" class="input input-bordered w-full" bind:value={effectiveTo} />
							{#if !rangeOk}
								<span class="text-xs text-error">{m.tax_change_range_error()}</span>
							{/if}
						</label>
					</div>

					<label class="flex flex-col gap-1">
						<span class="text-sm font-medium text-base-content">{m.tax_change_reason_label()}</span>
						<textarea
							class="textarea textarea-bordered w-full"
							rows="2"
							maxlength="500"
							placeholder={m.tax_change_reason_placeholder()}
							bind:value={reason}
							required
						></textarea>
						<span class="text-xs text-outline">{m.tax_change_reason_hint()}</span>
					</label>

					<div class="modal-action">
						<button type="button" class="btn btn-ghost" onclick={oncancel}
							>{m.common_cancel()}</button
						>
						<button type="submit" class="btn btn-primary" disabled={!canReview}>
							{m.tax_change_review()}
						</button>
					</div>
				</form>
			{:else}
				<div class="mt-3 flex flex-col gap-3 text-sm">
					<p class="font-medium text-base-content">{summary}</p>
					<p class="text-base-content-muted">
						{effectiveTo
							? m.tax_change_period_range({
									from: formatDate(effectiveFrom),
									to: formatDate(effectiveTo)
								})
							: m.tax_change_period_open({ from: formatDate(effectiveFrom) })}
					</p>
					<p class="rounded-md bg-base-200 px-3 py-2 text-base-content-muted">
						{m.tax_change_applies_note()}
					</p>
					<p class="text-base-content-muted">
						{m.tax_change_reason_quote({ reason: reason.trim() })}
					</p>
					{#if isPast}
						<label class="flex items-start gap-2 rounded-md border border-warning/40 px-3 py-2">
							<input
								type="checkbox"
								class="checkbox checkbox-sm mt-0.5"
								bind:checked={confirmPast}
							/>
							<span class="text-base-content">
								{m.tax_change_confirm_past({ date: formatDate(effectiveFrom) })}
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
						{m.common_back()}
					</button>
					<button type="button" class="btn btn-primary" onclick={save} disabled={busy || !canSave}>
						{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
						{m.tax_change_save()}
					</button>
				</div>
			{/if}
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={oncancel}
			disabled={busy}
			aria-label={m.common_close()}
		></button>
	</div>
{/if}
