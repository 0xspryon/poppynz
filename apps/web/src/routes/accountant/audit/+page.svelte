<script lang="ts">
	import { onMount } from 'svelte';
	import { listTaxAudit, taxWriteErrorText, type TaxAuditEntry } from '$lib/api/tax';
	import { toast } from '$lib/toast.svelte';

	const ENTITIES: Record<string, string> = {
		tax_rate: 'Rate',
		tax_supply_treatment: 'Treatment',
		tax_registration: 'Registration'
	};
	const ACTIONS: Record<string, string> = {
		create: 'Added',
		close: 'Closed',
		supersede: 'Superseded',
		delete: 'Removed'
	};

	let entries = $state<Array<TaxAuditEntry> | null>(null);
	let entity = $state('');

	async function load() {
		const result = await listTaxAudit(entity || undefined);
		if (result.ok) {
			entries = result.data.entries;
		} else {
			entries = [];
			toast.error(taxWriteErrorText(result.error), { title: 'Audit log not loaded' });
		}
	}

	onMount(() => void load());

	const when = (iso: string) =>
		new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

	/** The fields a row's change is about, read from its snapshot. */
	const describe = (entry: TaxAuditEntry) => {
		const row = (entry.after ?? entry.before ?? {}) as Record<string, unknown>;
		const dates = `${row.effectiveFrom ?? '?'} → ${row.effectiveTo ?? 'open'}`;
		switch (entry.entity) {
			case 'tax_rate':
				return `${String(row.component ?? '').toUpperCase()} (${row.jurisdictionCode}) ${Number(row.rateMillipercent) / 1000}% · ${dates}`;
			case 'tax_supply_treatment':
				return `${row.supplyTypeCode}: ${row.treatment} · ${dates}`;
			default:
				return `${row.program} (${row.jurisdictionCode}) ${row.registered ? 'registered' : 'not registered'} · ${dates}`;
		}
	};
</script>

<svelte:head>
	<title>Audit log · Poppynz accountant</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">Audit log</h1>
		<p class="text-sm text-base-content-muted">
			Every change to the tax configuration: who made it, when and why.
		</p>
	</div>
	<select
		class="select select-bordered select-sm"
		bind:value={entity}
		onchange={() => void load()}
		aria-label="Filter"
	>
		<option value="">All changes</option>
		{#each Object.entries(ENTITIES) as [value, label] (value)}
			<option {value}>{label}s</option>
		{/each}
	</select>
</div>

{#if entries === null}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if entries.length === 0}
	<p class="text-sm text-base-content-muted">No changes recorded.</p>
{:else}
	<div class="overflow-x-auto rounded-xl border border-card-border bg-base-100">
		<table class="table">
			<thead>
				<tr>
					<th>When</th>
					<th>What</th>
					<th>Change</th>
					<th>By</th>
					<th>Reason</th>
				</tr>
			</thead>
			<tbody>
				{#each entries as entry (entry.id)}
					<tr>
						<td class="whitespace-nowrap">{when(entry.createdAt)}</td>
						<td>{ACTIONS[entry.action] ?? entry.action} {ENTITIES[entry.entity] ?? entry.entity}</td
						>
						<td class="text-xs">{describe(entry)}</td>
						<td>{entry.actor ? (entry.actor.name ?? entry.actor.id) : 'System (seed)'}</td>
						<td class="text-sm">{entry.reason}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
