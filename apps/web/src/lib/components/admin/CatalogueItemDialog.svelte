<script lang="ts">
	/** Create/edit dialog for service-catalogue items (design 8e). Owns the
	 * draft fields; emits a validated draft on save. */
	import type { CatalogueItem } from '$lib/api/service-catalogue';
	import { getLocale } from '$lib/locale';
	import { centsToDollars, dollarsToCents } from '$lib/money';
	import { m } from '$lib/paraglide/messages';

	/** French writes the dollar sign after the amount. */
	const symbolAfter = getLocale() === 'fr';

	export interface CatalogueItemDraft {
		name: string;
		category: string;
		baseHourlyRateCents: number;
		isLive: boolean;
		/** A helper document that must be approved before a helper can offer
		 * this service (e.g. the PSW credential). Null = no credential. */
		requiredDocumentTypeId: string | null;
	}

	interface Props {
		open: boolean;
		/** The item being edited, or null when creating. */
		editing: CatalogueItem | null;
		/** Existing categories offered as datalist suggestions. */
		categories: Array<string>;
		/** Helper document types an admin can require as a credential. */
		credentialTypes?: Array<{ id: string; name: string }>;
		busy?: boolean;
		error?: string | null;
		onsave: (draft: CatalogueItemDraft) => void;
		oncancel: () => void;
	}

	let {
		open,
		editing,
		categories,
		credentialTypes = [],
		busy = false,
		error = null,
		onsave,
		oncancel
	}: Props = $props();

	let name = $state('');
	let category = $state('');
	let rate = $state('');
	let isLive = $state(true);
	let requiredDocumentTypeId = $state('');

	$effect(() => {
		if (open) {
			name = editing?.name ?? '';
			category = editing?.category ?? '';
			rate = editing ? centsToDollars(editing.baseHourlyRateCents) : '';
			isLive = editing?.isLive ?? true;
			requiredDocumentTypeId = editing?.requiredDocumentTypeId ?? '';
		}
	});

	const rateCents = $derived(dollarsToCents(rate));
	const canSave = $derived(name.trim() !== '' && category.trim() !== '' && rateCents !== null);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !canSave || rateCents === null) return;
		onsave({
			name: name.trim(),
			category: category.trim(),
			baseHourlyRateCents: rateCents,
			isLive,
			requiredDocumentTypeId: requiredDocumentTypeId === '' ? null : requiredDocumentTypeId
		});
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<form class="modal-box max-w-xl border border-card-border" onsubmit={submit}>
			<h3 class="font-display text-xl font-bold text-base-content">
				{editing ? m.admin_catalogue_edit_title() : m.admin_catalogue_new()}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{m.admin_catalogue_dialog_intro()}
			</p>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_catalogue_name_legend()}</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						required
						placeholder={m.admin_catalogue_name_placeholder()}
						bind:value={name}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_catalogue_category_legend()}</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="80"
						required
						placeholder={m.admin_catalogue_category_placeholder()}
						list="catalogue-categories"
						bind:value={category}
					/>
					<datalist id="catalogue-categories">
						{#each categories as entry (entry)}
							<option value={entry}></option>
						{/each}
					</datalist>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_catalogue_rate_legend()}</legend>
					<label class="input w-full {rate !== '' && rateCents === null ? 'input-error' : ''}">
						{#if !symbolAfter}<span class="text-outline">$</span>{/if}
						<input
							type="text"
							class="grow"
							inputmode="decimal"
							required
							placeholder={m.admin_catalogue_rate_placeholder()}
							bind:value={rate}
						/>
						{#if symbolAfter}<span class="text-outline">$</span>{/if}
					</label>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_catalogue_unit_legend()}</legend>
					<select class="select w-full" disabled>
						<option>{m.admin_catalogue_per_hour_option()}</option>
					</select>
				</fieldset>
			</div>

			<fieldset class="fieldset mt-3">
				<legend class="fieldset-legend">{m.admin_catalogue_credential_legend()}</legend>
				<select class="select w-full" bind:value={requiredDocumentTypeId}>
					<option value="">{m.admin_catalogue_credential_none()}</option>
					{#each credentialTypes as type (type.id)}
						<option value={type.id}>{type.name}</option>
					{/each}
				</select>
				<p class="label text-xs whitespace-normal">
					{m.admin_catalogue_credential_hint()}
				</p>
			</fieldset>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" checked disabled />
					<span class="text-sm font-medium text-base-content">
						{m.admin_catalogue_floor_toggle()}
					</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" bind:checked={isLive} />
					<span class="text-sm font-medium text-base-content"
						>{m.admin_catalogue_live_toggle()}</span
					>
				</label>
			</div>

			{#if error}
				<p class="mt-4 text-sm font-medium text-error" role="alert">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !canSave}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{m.admin_catalogue_save()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label={m.common_close()}
		></button>
	</div>
{/if}
