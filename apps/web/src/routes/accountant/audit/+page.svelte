<script lang="ts">
	import { onMount } from 'svelte';
	import {
		formatTaxRate,
		listTaxAudit,
		taxComponentLabel,
		taxTreatmentLabel,
		taxWriteErrorText,
		type TaxAuditEntry
	} from '$lib/api/tax';
	import { formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const FILTERS: Array<{ value: string; label: string }> = [
		{ value: 'tax_rate', label: m.accountant_audit_filter_rates() },
		{ value: 'tax_supply_treatment', label: m.accountant_audit_filter_treatments() },
		{ value: 'tax_registration', label: m.accountant_audit_filter_registrations() }
	];

	/** "Added Rate", "Inscription clôturée", … — one message per pair, since
	 * French agrees the participle with the entity. */
	const WHAT: Record<string, Record<string, () => string>> = {
		tax_rate: {
			create: m.accountant_audit_rate_create,
			close: m.accountant_audit_rate_close,
			supersede: m.accountant_audit_rate_supersede,
			delete: m.accountant_audit_rate_delete
		},
		tax_supply_treatment: {
			create: m.accountant_audit_treatment_create,
			close: m.accountant_audit_treatment_close,
			supersede: m.accountant_audit_treatment_supersede,
			delete: m.accountant_audit_treatment_delete
		},
		tax_registration: {
			create: m.accountant_audit_registration_create,
			close: m.accountant_audit_registration_close,
			supersede: m.accountant_audit_registration_supersede,
			delete: m.accountant_audit_registration_delete
		}
	};
	const what = (entry: TaxAuditEntry) =>
		WHAT[entry.entity]?.[entry.action]?.() ?? `${entry.action} ${entry.entity}`;

	let entries = $state<Array<TaxAuditEntry> | null>(null);
	let entity = $state('');

	async function load() {
		const result = await listTaxAudit(entity || undefined);
		if (result.ok) {
			entries = result.data.entries;
		} else {
			entries = [];
			toast.error(taxWriteErrorText(result.error), {
				title: m.accountant_audit_load_failed_title()
			});
		}
	}

	onMount(() => void load());

	/** The fields a row's change is about, read from its snapshot. */
	const describe = (entry: TaxAuditEntry) => {
		const row = (entry.after ?? entry.before ?? {}) as Record<string, unknown>;
		const dates = m.accountant_audit_dates({
			from: String(row.effectiveFrom ?? '?'),
			to: row.effectiveTo ? String(row.effectiveTo) : m.accountant_audit_open_ended()
		});
		const jurisdiction = String(row.jurisdictionCode ?? '');
		switch (entry.entity) {
			case 'tax_rate':
				return m.accountant_audit_rate_change({
					component: taxComponentLabel(String(row.component ?? '')),
					jurisdiction,
					rate: formatTaxRate(Number(row.rateMillipercent)),
					dates
				});
			case 'tax_supply_treatment':
				return m.accountant_audit_treatment_change({
					supply: String(row.supplyTypeCode ?? ''),
					treatment: taxTreatmentLabel(String(row.treatment ?? '')),
					dates
				});
			default: {
				const params = { program: String(row.program ?? ''), jurisdiction, dates };
				return row.registered
					? m.accountant_audit_registration_registered(params)
					: m.accountant_audit_registration_not_registered(params);
			}
		}
	};
</script>

<svelte:head>
	<title>{m.accountant_audit_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.accountant_audit_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.accountant_audit_intro()}
		</p>
	</div>
	<select
		class="select select-bordered select-sm"
		bind:value={entity}
		onchange={() => void load()}
		aria-label={m.accountant_audit_filter()}
	>
		<option value="">{m.accountant_audit_all()}</option>
		{#each FILTERS as filter (filter.value)}
			<option value={filter.value}>{filter.label}</option>
		{/each}
	</select>
</div>

{#if entries === null}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if entries.length === 0}
	<p class="text-sm text-base-content-muted">{m.accountant_audit_empty()}</p>
{:else}
	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table">
			<thead>
				<tr>
					<th>{m.accountant_audit_col_when()}</th>
					<th>{m.accountant_audit_col_what()}</th>
					<th>{m.accountant_audit_col_change()}</th>
					<th>{m.accountant_audit_col_by()}</th>
					<th>{m.accountant_audit_col_reason()}</th>
				</tr>
			</thead>
			<tbody>
				{#each entries as entry (entry.id)}
					<tr>
						<td class="whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
						<td>{what(entry)}</td>
						<td class="text-xs">{describe(entry)}</td>
						<td
							>{entry.actor
								? (entry.actor.name ?? entry.actor.id)
								: m.accountant_audit_system()}</td
						>
						<td class="text-sm">{entry.reason}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
