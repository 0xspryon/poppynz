<script lang="ts">
	import { onMount } from 'svelte';
	import {
		formatRatePercent,
		formatTaxRate,
		getTaxConfig,
		parseRatePercent,
		supersedeTaxRate,
		taxComponentLabel,
		taxWriteErrorText,
		type TaxComponent,
		type TaxConfig,
		type TaxRateRow
	} from '$lib/api/tax';
	import { formatDate } from '$lib/date';
	import FrozenChargesNote from '$lib/components/tax/FrozenChargesNote.svelte';
	import TaxChangeDialog, { type EffectiveDraft } from '$lib/components/tax/TaxChangeDialog.svelte';
	import TaxStanding from '$lib/components/tax/TaxStanding.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const COMPONENTS: Array<TaxComponent> = ['gst', 'hst', 'pst', 'qst', 'rst'];

	let config = $state<TaxConfig | null>(null);
	let loadFailed = $state(false);
	let jurisdictionFilter = $state('');
	let componentFilter = $state('');

	let dialogOpen = $state(false);
	let saving = $state(false);
	let jurisdictionCode = $state('ON');
	let component = $state<TaxComponent>('hst');
	let rate = $state('');

	async function load() {
		const result = await getTaxConfig();
		if (result.ok) {
			config = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_rates_load_failed_title()
			});
		}
	}

	onMount(() => void load());

	const rows = $derived(
		(config?.rates ?? []).filter(
			(row) =>
				(jurisdictionFilter === '' || row.jurisdictionCode === jurisdictionFilter) &&
				(componentFilter === '' || row.component === componentFilter)
		)
	);
	const rateMillipercent = $derived(parseRatePercent(rate));

	function openChange(row: TaxRateRow | null) {
		jurisdictionCode = row?.jurisdictionCode ?? (jurisdictionFilter || 'ON');
		component = row?.component ?? 'hst';
		rate = row ? formatRatePercent(row.rateMillipercent) : '';
		dialogOpen = true;
	}

	async function save(draft: EffectiveDraft) {
		if (saving || rateMillipercent === null) return;
		saving = true;
		const result = await supersedeTaxRate({
			jurisdictionCode,
			component,
			rateMillipercent,
			...draft
		});
		saving = false;
		if (result.ok) {
			dialogOpen = false;
			toast.success(
				m.accountant_rates_saved_body({
					component: taxComponentLabel(component),
					jurisdiction: jurisdictionCode,
					rate: formatTaxRate(rateMillipercent),
					date: formatDate(draft.effectiveFrom)
				}),
				{ title: m.accountant_rates_saved_title() }
			);
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), { title: m.accountant_rates_not_saved_title() });
		}
	}
</script>

<svelte:head>
	<title>{m.accountant_rates_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.accountant_rates_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.accountant_rates_intro()}
		</p>
	</div>
	<button type="button" class="btn btn-primary" disabled={!config} onclick={() => openChange(null)}>
		<i class="las la-plus" aria-hidden="true"></i>
		{m.accountant_rates_new()}
	</button>
</div>

{#if !config && !loadFailed}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if config}
	<div class="mb-4 flex flex-wrap gap-3">
		<select
			class="select select-bordered select-sm"
			bind:value={jurisdictionFilter}
			aria-label={m.accountant_jurisdiction()}
		>
			<option value="">{m.accountant_all_jurisdictions()}</option>
			{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
				<option value={jurisdiction.code}>{jurisdiction.code} · {jurisdiction.name}</option>
			{/each}
		</select>
		<select
			class="select select-bordered select-sm"
			bind:value={componentFilter}
			aria-label={m.accountant_component()}
		>
			<option value="">{m.accountant_all_components()}</option>
			{#each COMPONENTS as value (value)}
				<option {value}>{taxComponentLabel(value)}</option>
			{/each}
		</select>
	</div>

	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table">
			<thead>
				<tr>
					<th>{m.accountant_jurisdiction()}</th>
					<th>{m.accountant_component()}</th>
					<th class="text-right">{m.accountant_col_rate()}</th>
					<th>{m.accountant_col_from()}</th>
					<th>{m.accountant_col_until()}</th>
					<th>{m.accountant_col_status()}</th>
					<th><span class="sr-only">{m.accountant_col_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<td>{row.jurisdictionCode}</td>
						<td>{taxComponentLabel(row.component)}</td>
						<td class="text-right tabular-nums">{formatTaxRate(row.rateMillipercent)}</td>
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
				{:else}
					<tr>
						<td colspan="7" class="text-sm text-base-content-muted">{m.accountant_rates_none()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<FrozenChargesNote />

	<TaxChangeDialog
		open={dialogOpen}
		title={m.accountant_rates_dialog_title()}
		today={config.today}
		valid={rateMillipercent !== null}
		summary={m.accountant_rates_summary({
			component: taxComponentLabel(component),
			jurisdiction: jurisdictionCode,
			rate: formatTaxRate(rateMillipercent ?? 0)
		})}
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_jurisdiction()}</span>
				<select class="select select-bordered w-full" bind:value={jurisdictionCode}>
					{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
						<option value={jurisdiction.code}>{jurisdiction.code}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_component()}</span>
				<select class="select select-bordered w-full" bind:value={component}>
					{#each COMPONENTS as value (value)}
						<option {value}>{taxComponentLabel(value)}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_rates_rate_label()}</span>
				<input
					class="input input-bordered w-full"
					inputmode="decimal"
					placeholder="13"
					bind:value={rate}
				/>
				{#if rate !== '' && rateMillipercent === null}
					<span class="text-xs text-error">{m.accountant_rates_rate_invalid()}</span>
				{/if}
			</label>
		</div>
	</TaxChangeDialog>
{/if}
