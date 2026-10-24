<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getTaxConfig,
		supersedeTaxTreatment,
		taxWriteErrorText,
		type TaxComponent,
		type TaxConfig,
		type TaxTreatmentRow
	} from '$lib/api/tax';
	import { formatDate } from '$lib/date';
	import ComponentPicker from '$lib/components/tax/ComponentPicker.svelte';
	import FrozenChargesNote from '$lib/components/tax/FrozenChargesNote.svelte';
	import TaxChangeDialog, { type EffectiveDraft } from '$lib/components/tax/TaxChangeDialog.svelte';
	import TaxStanding from '$lib/components/tax/TaxStanding.svelte';
	import { toast } from '$lib/toast.svelte';

	type Treatment = TaxTreatmentRow['treatment'];
	type Place = TaxTreatmentRow['placeOfSupply'];

	const TREATMENTS: Record<Treatment, string> = {
		taxable: 'Taxable',
		exempt: 'Exempt',
		zero_rated: 'Zero-rated',
		out_of_scope: 'Out of scope'
	};
	const PLACES: Record<Place, string> = {
		payer_province: "Payer's province",
		helper_province: "Helper's province",
		contract_location: 'Contract location (family)'
	};

	let config = $state<TaxConfig | null>(null);
	let loadFailed = $state(false);
	let dialogOpen = $state(false);
	let saving = $state(false);
	let supplyTypeCode = $state('family_service_fee');
	let treatment = $state<Treatment>('taxable');
	let components = $state<Array<TaxComponent>>([]);
	let placeOfSupply = $state<Place>('contract_location');

	async function load() {
		const result = await getTaxConfig();
		if (result.ok) {
			config = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(taxWriteErrorText(result.error), { title: 'Treatments not loaded' });
		}
	}

	onMount(() => void load());

	const supplyName = (code: string) =>
		config?.supplyTypes.find((row) => row.code === code)?.name ?? code;
	const valid = $derived(treatment !== 'taxable' || components.length > 0);

	function openChange(row: TaxTreatmentRow) {
		supplyTypeCode = row.supplyTypeCode;
		treatment = row.treatment;
		components = [...row.components];
		placeOfSupply = row.placeOfSupply;
		dialogOpen = true;
	}

	async function save(draft: EffectiveDraft) {
		if (saving) return;
		saving = true;
		const result = await supersedeTaxTreatment({
			supplyTypeCode: supplyTypeCode as TaxTreatmentRow['supplyTypeCode'],
			treatment,
			components: treatment === 'taxable' ? components : [],
			placeOfSupply,
			...draft
		});
		saving = false;
		if (result.ok) {
			dialogOpen = false;
			toast.success(`${supplyName(supplyTypeCode)} from ${formatDate(draft.effectiveFrom)}.`, {
				title: 'Treatment saved'
			});
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), { title: 'Treatment not saved' });
		}
	}
</script>

<svelte:head>
	<title>Supply treatments · Poppynz accountant</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		Supply treatments
	</h1>
	<p class="text-sm text-base-content-muted">
		How each kind of supply is taxed: its treatment, the components that apply and where it is
		supplied.
	</p>
</div>

{#if !config && !loadFailed}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if config}
	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table">
			<thead>
				<tr>
					<th>Supply</th>
					<th>Treatment</th>
					<th>Components</th>
					<th>Place of supply</th>
					<th>From</th>
					<th>Until</th>
					<th>Status</th>
					<th><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each config.treatments as row (row.id)}
					<tr>
						<td>{supplyName(row.supplyTypeCode)}</td>
						<td>{TREATMENTS[row.treatment]}</td>
						<td>{row.components.map((value) => value.toUpperCase()).join(', ') || '—'}</td>
						<td>{PLACES[row.placeOfSupply]}</td>
						<td class="whitespace-nowrap">{formatDate(row.effectiveFrom)}</td>
						<td class="whitespace-nowrap">{row.effectiveTo ? formatDate(row.effectiveTo) : '—'}</td>
						<td><TaxStanding standing={row.standing} /></td>
						<td class="text-right">
							{#if row.standing !== 'ended'}
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => openChange(row)}>
									Change
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<FrozenChargesNote />

	<TaxChangeDialog
		open={dialogOpen}
		title="Change how {supplyName(supplyTypeCode)} is taxed"
		today={config.today}
		{valid}
		summary="{supplyName(supplyTypeCode)}: {TREATMENTS[treatment]}{treatment === 'taxable'
			? ` (${components.map((value) => value.toUpperCase()).join(', ')})`
			: ''}, {PLACES[placeOfSupply].toLowerCase()}"
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Treatment</span>
				<select class="select select-bordered w-full" bind:value={treatment}>
					{#each Object.entries(TREATMENTS) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Place of supply</span>
				<select class="select select-bordered w-full" bind:value={placeOfSupply}>
					{#each Object.entries(PLACES) as [value, label] (value)}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
		</div>
		<ComponentPicker bind:selected={components} disabled={treatment !== 'taxable'} />
		{#if treatment === 'taxable' && components.length === 0}
			<span class="text-xs text-error">A taxable supply needs at least one component.</span>
		{/if}
	</TaxChangeDialog>
{/if}
