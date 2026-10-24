<script lang="ts">
	/** Create/edit dialog for service-catalogue items (design 8e). Owns the
	 * draft fields; emits a validated draft on save. */
	import type { CatalogueItem } from '$lib/api/service-catalogue';
	import { centsToDollars, dollarsToCents } from '$lib/money';

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
				{editing ? 'Edit service' : 'New service'}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				The base rate is the floor providers can raise but never undercut.
			</p>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Name · ≤120</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="120"
						required
						placeholder="Weekend babysitting"
						bind:value={name}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Category</legend>
					<input
						type="text"
						class="input w-full"
						maxlength="80"
						required
						placeholder="Childcare"
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
					<legend class="fieldset-legend">Base rate / hour</legend>
					<label class="input w-full {rate !== '' && rateCents === null ? 'input-error' : ''}">
						<span class="text-outline">$</span>
						<input
							type="text"
							class="grow"
							inputmode="decimal"
							required
							placeholder="19.00"
							bind:value={rate}
						/>
					</label>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Unit</legend>
					<select class="select w-full" disabled>
						<option>Per hour</option>
					</select>
				</fieldset>
			</div>

			<fieldset class="fieldset mt-3">
				<legend class="fieldset-legend">Required credential</legend>
				<select class="select w-full" bind:value={requiredDocumentTypeId}>
					<option value="">None — any approved helper can offer it</option>
					{#each credentialTypes as type (type.id)}
						<option value={type.id}>{type.name}</option>
					{/each}
				</select>
				<p class="label text-xs whitespace-normal">
					A helper can only offer this service once an administrator has approved this document.
				</p>
			</fieldset>

			<div class="mt-4 flex flex-wrap gap-x-6 gap-y-3">
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" checked disabled />
					<span class="text-sm font-medium text-base-content">
						Rate is a floor — providers may raise it
					</span>
				</label>
				<label class="flex items-center gap-2.5">
					<input type="checkbox" class="toggle toggle-primary" bind:checked={isLive} />
					<span class="text-sm font-medium text-base-content">Live in the provider catalogue</span>
				</label>
			</div>

			{#if error}
				<p class="mt-4 text-sm font-medium text-error" role="alert">{error}</p>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !canSave}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Save service
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label="Close"></button>
	</div>
{/if}
