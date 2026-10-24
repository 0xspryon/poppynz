<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getTaxConfig,
		supersedeTaxRegistration,
		taxWriteErrorText,
		type TaxComponent,
		type TaxConfig,
		type TaxRegistrationRow
	} from '$lib/api/tax';
	import { formatDate } from '$lib/date';
	import ComponentPicker from '$lib/components/tax/ComponentPicker.svelte';
	import FrozenChargesNote from '$lib/components/tax/FrozenChargesNote.svelte';
	import TaxChangeDialog, { type EffectiveDraft } from '$lib/components/tax/TaxChangeDialog.svelte';
	import TaxStanding from '$lib/components/tax/TaxStanding.svelte';
	import { toast } from '$lib/toast.svelte';

	let config = $state<TaxConfig | null>(null);
	let loadFailed = $state(false);
	let dialogOpen = $state(false);
	let saving = $state(false);
	let jurisdictionCode = $state('CA');
	let program = $state('gst_hst');
	let components = $state<Array<TaxComponent>>(['gst', 'hst']);
	let registrationNumber = $state('');
	let registered = $state(true);

	/** Mirrors the server rule: nothing, or a number marked as a placeholder. */
	const looksLikePlaceholder = (value: string) => value.trim() === '' || /placeholder/i.test(value);

	async function load() {
		const result = await getTaxConfig();
		if (result.ok) {
			config = result.data;
			loadFailed = false;
		} else {
			loadFailed = true;
			toast.error(taxWriteErrorText(result.error), { title: 'Registrations not loaded' });
		}
	}

	onMount(() => void load());

	const valid = $derived(/^[a-z_]{2,20}$/.test(program.trim()) && components.length > 0);

	function openChange(row: TaxRegistrationRow | null) {
		jurisdictionCode = row?.jurisdictionCode ?? 'CA';
		program = row?.program ?? '';
		components = row ? [...row.components] : [];
		registrationNumber = row?.registrationNumber ?? '';
		registered = row?.registered ?? true;
		dialogOpen = true;
	}

	async function save(draft: EffectiveDraft) {
		if (saving) return;
		saving = true;
		const result = await supersedeTaxRegistration({
			jurisdictionCode,
			program: program.trim(),
			components,
			registrationNumber: registrationNumber.trim() === '' ? null : registrationNumber.trim(),
			registered,
			...draft
		});
		saving = false;
		if (result.ok) {
			dialogOpen = false;
			toast.success(`${program} (${jurisdictionCode}) from ${formatDate(draft.effectiveFrom)}.`, {
				title: 'Registration saved'
			});
			if (result.data.warnings.length > 0) {
				toast.info(
					'The number is still a placeholder: receipts show the registration as pending.',
					{
						title: 'Placeholder number'
					}
				);
			}
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), { title: 'Registration not saved' });
		}
	}
</script>

<svelte:head>
	<title>Registrations · Poppynz accountant</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			Registrations
		</h1>
		<p class="text-sm text-base-content-muted">
			Poppynz's sales-tax registrations. A component is charged only while a registration covering
			it is in force and switched on.
		</p>
	</div>
	<button type="button" class="btn btn-primary" disabled={!config} onclick={() => openChange(null)}>
		<i class="las la-plus" aria-hidden="true"></i>
		New registration
	</button>
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
					<th>Jurisdiction</th>
					<th>Program</th>
					<th>Components</th>
					<th>Number</th>
					<th>Registered</th>
					<th>From</th>
					<th>Until</th>
					<th>Status</th>
					<th><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each config.registrations as row (row.id)}
					<tr>
						<td>{row.jurisdictionCode}</td>
						<td>{row.program}</td>
						<td>{row.components.map((value) => value.toUpperCase()).join(', ')}</td>
						<td>
							<span class="font-mono text-xs">{row.registrationNumber ?? '—'}</span>
							{#if row.isPlaceholder}
								<span class="badge badge-sm badge-warning ml-1">Placeholder</span>
							{/if}
						</td>
						<td>{row.registered ? 'Yes' : 'No'}</td>
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
	<p class="mt-4 max-w-2xl text-xs text-outline">
		A placeholder number is never printed on a receipt: the registration shows as pending until the
		real number is entered.
	</p>
	<FrozenChargesNote />

	<TaxChangeDialog
		open={dialogOpen}
		title="Set a registration"
		today={config.today}
		{valid}
		summary="{program} ({jurisdictionCode}) — {registered
			? 'registered'
			: 'not registered'}{registrationNumber.trim() ? `, number ${registrationNumber.trim()}` : ''}"
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Jurisdiction</span>
				<select class="select select-bordered w-full" bind:value={jurisdictionCode}>
					{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
						<option value={jurisdiction.code}>{jurisdiction.code} · {jurisdiction.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Program</span>
				<input class="input input-bordered w-full" placeholder="gst_hst" bind:value={program} />
			</label>
		</div>
		<ComponentPicker bind:selected={components} />
		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium text-base-content">Registration number</span>
			<input
				class="input input-bordered w-full font-mono"
				placeholder="123456789RT0001"
				bind:value={registrationNumber}
			/>
			{#if registered && looksLikePlaceholder(registrationNumber)}
				<span class="text-xs text-warning">
					This is a placeholder: receipts will show the registration as pending.
				</span>
			{/if}
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={registered} />
			Registered — charge the covered components
		</label>
	</TaxChangeDialog>
{/if}
