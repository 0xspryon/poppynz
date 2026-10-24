<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getTaxConfig,
		supersedeTaxRegistration,
		taxComponentList,
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
	import { m } from '$lib/paraglide/messages';
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
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_registrations_load_failed_title()
			});
		}
	}

	onMount(() => void load());

	const summary = $derived.by(() => {
		const params = { program, jurisdiction: jurisdictionCode, number: registrationNumber.trim() };
		if (registered) {
			return params.number
				? m.accountant_registrations_summary_registered_number(params)
				: m.accountant_registrations_summary_registered(params);
		}
		return params.number
			? m.accountant_registrations_summary_not_registered_number(params)
			: m.accountant_registrations_summary_not_registered(params);
	});

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
			toast.success(
				m.accountant_registrations_saved_body({
					program,
					jurisdiction: jurisdictionCode,
					date: formatDate(draft.effectiveFrom)
				}),
				{ title: m.accountant_registrations_saved_title() }
			);
			if (result.data.warnings.length > 0) {
				toast.info(m.accountant_registrations_placeholder_toast(), {
					title: m.accountant_registrations_placeholder_title()
				});
			}
			await load();
		} else {
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_registrations_not_saved_title()
			});
		}
	}
</script>

<svelte:head>
	<title>{m.accountant_registrations_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.accountant_registrations_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.accountant_registrations_intro()}
		</p>
	</div>
	<button type="button" class="btn btn-primary" disabled={!config} onclick={() => openChange(null)}>
		<i class="las la-plus" aria-hidden="true"></i>
		{m.accountant_registrations_new()}
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
					<th>{m.accountant_jurisdiction()}</th>
					<th>{m.accountant_col_program()}</th>
					<th>{m.accountant_col_components()}</th>
					<th>{m.accountant_col_number()}</th>
					<th>{m.accountant_col_registered()}</th>
					<th>{m.accountant_col_from()}</th>
					<th>{m.accountant_col_until()}</th>
					<th>{m.accountant_col_status()}</th>
					<th><span class="sr-only">{m.accountant_col_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each config.registrations as row (row.id)}
					<tr>
						<td>{row.jurisdictionCode}</td>
						<td>{row.program}</td>
						<td>{taxComponentList(row.components)}</td>
						<td>
							<span class="font-mono text-xs">{row.registrationNumber ?? '—'}</span>
							{#if row.isPlaceholder}
								<span class="badge badge-sm badge-warning ml-1">
									{m.accountant_registrations_placeholder_badge()}
								</span>
							{/if}
						</td>
						<td>{row.registered ? m.common_yes() : m.common_no()}</td>
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
	<p class="mt-4 max-w-2xl text-xs text-outline">
		{m.accountant_registrations_placeholder_note()}
	</p>
	<FrozenChargesNote />

	<TaxChangeDialog
		open={dialogOpen}
		title={m.accountant_registrations_dialog_title()}
		today={config.today}
		{valid}
		{summary}
		busy={saving}
		onsave={(draft) => void save(draft)}
		oncancel={() => (dialogOpen = false)}
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_jurisdiction()}</span>
				<select class="select select-bordered w-full" bind:value={jurisdictionCode}>
					{#each config.jurisdictions as jurisdiction (jurisdiction.code)}
						<option value={jurisdiction.code}>{jurisdiction.code} · {jurisdiction.name}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">{m.accountant_col_program()}</span>
				<input class="input input-bordered w-full" placeholder="gst_hst" bind:value={program} />
			</label>
		</div>
		<ComponentPicker bind:selected={components} />
		<label class="flex flex-col gap-1">
			<span class="text-sm font-medium text-base-content"
				>{m.accountant_registrations_number_label()}</span
			>
			<input
				class="input input-bordered w-full font-mono"
				placeholder="123456789RT0001"
				bind:value={registrationNumber}
			/>
			{#if registered && looksLikePlaceholder(registrationNumber)}
				<span class="text-xs text-warning">
					{m.accountant_registrations_placeholder_warning()}
				</span>
			{/if}
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={registered} />
			{m.accountant_registrations_registered_toggle()}
		</label>
	</TaxChangeDialog>
{/if}
