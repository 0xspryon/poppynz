<script lang="ts">
	import { onMount } from 'svelte';
	import {
		formatRatePercent,
		getTaxConfig,
		parseRatePercent,
		supersedeTaxRate,
		taxWriteErrorText,
		type TaxComponent,
		type TaxConfig,
		type TaxRateRow
	} from '$lib/api/tax';
	import { formatDate } from '$lib/date';
	import FrozenChargesNote from '$lib/components/tax/FrozenChargesNote.svelte';
	import TaxChangeDialog, { type EffectiveDraft } from '$lib/components/tax/TaxChangeDialog.svelte';
	import TaxStanding from '$lib/components/tax/TaxStanding.svelte';
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
			toast.error(taxWriteErrorText(result.error), { title: 'Rates not loaded' });
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
				`${component.toUpperCase()} (${jurisdictionCode}) ${rate}% from ${formatDate(draft.effectiveFrom)}.`,
				{ title: 'Rate saved' }
			);
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), { title: 'Rate not saved' });
		}
	}
</script>

<svelte:head>
	<title>Tax rates · Poppynz accountant</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">Tax rates</h1>
		<p class="text-sm text-base-content-muted">
			Effective-dated rates by jurisdiction and component.
		</p>
	</div>
	<button type="button" class="btn btn-primary" disabled={!config} onclick={() => openChange(null)}>
		<i class="las la-plus" aria-hidden="true"></i>
		New rate
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
			aria-label="Jurisdiction"
		>
			<option value="">All jurisdictions</option>
			{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
				<option value={jurisdiction.code}>{jurisdiction.code} · {jurisdiction.name}</option>
			{/each}
		</select>
		<select
			class="select select-bordered select-sm"
			bind:value={componentFilter}
			aria-label="Component"
		>
			<option value="">All components</option>
			{#each COMPONENTS as value (value)}
				<option {value}>{value.toUpperCase()}</option>
			{/each}
		</select>
	</div>

	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table">
			<thead>
				<tr>
					<th>Jurisdiction</th>
					<th>Component</th>
					<th class="text-right">Rate</th>
					<th>From</th>
					<th>Until</th>
					<th>Status</th>
					<th><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<td>{row.jurisdictionCode}</td>
						<td>{row.component.toUpperCase()}</td>
						<td class="text-right tabular-nums">{formatRatePercent(row.rateMillipercent)}%</td>
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
				{:else}
					<tr><td colspan="7" class="text-sm text-base-content-muted">No rates match.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<FrozenChargesNote />

	<TaxChangeDialog
		open={dialogOpen}
		title="Set a tax rate"
		today={config.today}
		valid={rateMillipercent !== null}
		summary="{component.toUpperCase()} ({jurisdictionCode}) at {rate}%"
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Jurisdiction</span>
				<select class="select select-bordered w-full" bind:value={jurisdictionCode}>
					{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
						<option value={jurisdiction.code}>{jurisdiction.code}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Component</span>
				<select class="select select-bordered w-full" bind:value={component}>
					{#each COMPONENTS as value (value)}
						<option {value}>{value.toUpperCase()}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Rate (%)</span>
				<input
					class="input input-bordered w-full"
					inputmode="decimal"
					placeholder="13"
					bind:value={rate}
				/>
				{#if rate !== '' && rateMillipercent === null}
					<span class="text-xs text-error">A percentage from 0 to 100, up to 3 decimals.</span>
				{/if}
			</label>
		</div>
	</TaxChangeDialog>
{/if}
