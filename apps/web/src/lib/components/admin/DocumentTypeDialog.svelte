<script lang="ts">
	/** Create/edit dialog for KYC document types (design 8d). Owns the draft;
	 * emits it on save. */
	import { credibledCheckTypes, type CredibledCheckTypeValue } from '@repo/credibled/check-types';
	import type { DocumentType, DocumentTypeDraft } from '$lib/api/document-types';
	import { getLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';

	/** French writes the dollar sign after the amount. */
	const symbolAfter = getLocale() === 'fr';

	interface Props {
		open: boolean;
		/** The type being edited, or null when creating. */
		editing: DocumentType | null;
		busy?: boolean;
		error?: string | null;
		onsave: (draft: DocumentTypeDraft) => void;
		oncancel: () => void;
	}

	let { open, editing, busy = false, error = null, onsave, oncancel }: Props = $props();

	const blankDraft = (): DocumentTypeDraft => ({
		name: '',
		appliesToRole: 'service-provider',
		isOptional: false,
		requiresExpiryDate: true,
		credibledCheckTypeValue: null,
		credibledCostCents: null,
		isSafetyGate: false
	});

	/** The form edits dollars; the API stores cents. */
	let costDollars = $state('');

	let draft: DocumentTypeDraft = $state(blankDraft());

	$effect(() => {
		if (open) {
			draft = editing
				? {
						name: editing.name,
						appliesToRole: editing.appliesToRole === 'family' ? 'family' : 'service-provider',
						isOptional: editing.isOptional,
						requiresExpiryDate: editing.requiresExpiryDate,
						credibledCheckTypeValue:
							(editing.credibledCheckTypeValue as CredibledCheckTypeValue | null) ?? null,
						credibledCostCents: editing.credibledCostCents ?? null,
						isSafetyGate: editing.isSafetyGate
					}
				: blankDraft();
			// Derived from `editing`, NOT from `draft`. Reading `draft` here would
			// make this effect depend on the state it just wrote, and Svelte would
			// re-run it forever (effect_update_depth_exceeded).
			costDollars =
				editing?.credibledCostCents == null ? '' : (editing.credibledCostCents / 100).toFixed(2);
		}
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !draft.name.trim()) return;
		const parsed = Number.parseFloat(costDollars);
		onsave({
			...draft,
			// Round at the boundary — 45.675 must not become 4567.4999 cents.
			credibledCostCents:
				draft.credibledCheckTypeValue === null || !Number.isFinite(parsed)
					? null
					: Math.round(parsed * 100)
		});
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<form class="modal-box max-w-lg border border-card-border" onsubmit={submit}>
			<h3 class="font-display text-xl font-bold text-base-content">
				{editing ? m.admin_doctypes_edit_title() : m.admin_doctypes_new_title()}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{editing ? m.admin_doctypes_edit_intro() : m.admin_doctypes_new_intro()}
			</p>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_doctypes_name_legend()}</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						required
						placeholder={m.admin_doctypes_name_placeholder()}
						bind:value={draft.name}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_doctypes_col_applies_to()}</legend>
					<select class="select w-full" bind:value={draft.appliesToRole}>
						<option value="service-provider">{m.admin_doctypes_role_provider()}</option>
						<option value="family">{m.admin_doctypes_role_family()}</option>
					</select>
				</fieldset>
			</div>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
				<label class="flex items-center gap-2.5">
					<input
						type="checkbox"
						class="toggle toggle-primary"
						checked={!draft.isOptional}
						onchange={(event) => (draft.isOptional = !event.currentTarget.checked)}
					/>
					<span class="text-sm font-medium text-base-content">{m.common_required()}</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input
						type="checkbox"
						class="toggle toggle-primary"
						bind:checked={draft.requiresExpiryDate}
					/>
					<span class="text-sm font-medium text-base-content"
						>{m.admin_doctypes_needs_expiry()}</span
					>
				</label>
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" bind:checked={draft.isSafetyGate} />
					<span class="text-sm font-medium text-base-content">{m.admin_doctypes_safety_gate()}</span
					>
				</label>
			</div>
			{#if draft.isSafetyGate}
				<p class="mt-1.5 text-xs text-base-content-muted">
					{m.admin_doctypes_gate_hint()}
				</p>
			{/if}

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.admin_doctypes_collect_via()}</legend>
				<select
					class="select w-full"
					value={draft.credibledCheckTypeValue ?? ''}
					onchange={(event) =>
						(draft.credibledCheckTypeValue =
							(event.currentTarget.value as CredibledCheckTypeValue) || null)}
				>
					<option value="">{m.admin_doctypes_upload_only_option()}</option>
					{#each credibledCheckTypes as checkType (checkType.value)}
						<option value={checkType.value}>{checkType.label}</option>
					{/each}
				</select>
				<p class="mt-1.5 text-xs text-base-content-muted">
					{m.admin_doctypes_collect_hint()}
				</p>
			</fieldset>

			{@debug draft}
			{#if draft.credibledCheckTypeValue}
				<fieldset class="fieldset mt-3">
					<legend class="fieldset-legend">{m.admin_doctypes_price_legend()}</legend>
					<label class="input w-full">
						{#if !symbolAfter}<span class="text-base-content-muted">$</span>{/if}
						<input
							type="number"
							min="0"
							step="0.01"
							required
							placeholder="55.00"
							bind:value={costDollars}
						/>
						{#if symbolAfter}<span class="text-base-content-muted">$</span>{/if}
					</label>
					<p class="mt-1.5 text-xs text-base-content-muted">
						{m.admin_doctypes_price_hint()}
					</p>
				</fieldset>
			{/if}

			{#if error}
				<p class="mt-4 text-sm font-medium text-error" role="alert">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !draft.name.trim()}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{editing ? m.admin_doctypes_save_changes() : m.admin_doctypes_create()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label={m.common_close()}
		></button>
	</div>
{/if}
