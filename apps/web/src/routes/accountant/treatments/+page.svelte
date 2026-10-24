<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getTaxConfig,
		supersedeTaxTreatment,
		taxComponentList,
		taxPlaceLabel,
		taxTreatmentLabel,
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
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	type Treatment = TaxTreatmentRow['treatment'];
	type Place = TaxTreatmentRow['placeOfSupply'];

	const TREATMENTS: Array<Treatment> = ['taxable', 'exempt', 'zero_rated', 'out_of_scope'];
	const PLACES: Array<Place> = ['payer_province', 'helper_province', 'contract_location'];

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
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_treatments_load_failed_title()
			});
		}
	}

	onMount(() => void load());

	const supplyName = (code: string) =>
		config?.supplyTypes.find((row) => row.code === code)?.name ?? code;
	const summary = $derived.by(() => {
		const params = {
			supply: supplyName(supplyTypeCode),
			treatment: taxTreatmentLabel(treatment),
			place: taxPlaceLabel(placeOfSupply).toLowerCase()
		};
		return treatment === 'taxable'
			? m.accountant_treatments_summary_taxable({
					...params,
					components: taxComponentList(components)
				})
			: m.accountant_treatments_summary(params);
	});
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
			toast.success(
				m.accountant_treatments_saved_body({
					supply: supplyName(supplyTypeCode),
					date: formatDate(draft.effectiveFrom)
				}),
				{ title: m.accountant_treatments_saved_title() }
			);
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_treatments_not_saved_title()
			});
		}
	}
</script>

<svelte:head>
	<title>{m.accountant_treatments_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.accountant_treatments_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">
		{m.accountant_treatments_intro()}
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
					<th>{m.accountant_col_supply()}</th>
					<th>{m.accountant_col_treatment()}</th>
					<th>{m.accountant_col_components()}</th>
					<th>{m.accountant_col_place()}</th>
					<th>{m.accountant_col_from()}</th>
					<th>{m.accountant_col_until()}</th>
					<th>{m.accountant_col_status()}</th>
					<th><span class="sr-only">{m.accountant_col_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each config.treatments as row (row.id)}
					<tr>
						<td>{supplyName(row.supplyTypeCode)}</td>
						<td>{taxTreatmentLabel(row.treatment)}</td>
						<td>{taxComponentList(row.components) || '—'}</td>
						<td>{taxPlaceLabel(row.placeOfSupply)}</td>
						<td class="whitespace-nowrap">{formatDate(row.effectiveFrom)}</td>
						<td class="whitespace-nowrap">{row.effectiveTo ? formatDate(row.effectiveTo) : '—'}</td>
						<td><TaxStanding standing={row.standing} /></td>
						<td class="text-right">
							{#if row.standing !== 'ended'}
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => openChange(row)}>
									{m.accountant_change()}
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
		title={m.accountant_treatments_dialog_title({ supply: supplyName(supplyTypeCode) })}
		today={config.today}
		{valid}
		{summary}
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_col_treatment()}</span>
				<select class="select select-bordered w-full" bind:value={treatment}>
					{#each TREATMENTS as value (value)}
						<option {value}>{taxTreatmentLabel(value)}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_col_place()}</span>
				<select class="select select-bordered w-full" bind:value={placeOfSupply}>
					{#each PLACES as value (value)}
						<option {value}>{taxPlaceLabel(value)}</option>
					{/each}
				</select>
			</label>
		</div>
		<ComponentPicker bind:selected={components} disabled={treatment !== 'taxable'} />
		{#if treatment === 'taxable' && components.length === 0}
			<span class="text-xs text-error">{m.accountant_treatments_components_required()}</span>
		{/if}
	</TaxChangeDialog>
{/if}
