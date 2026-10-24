<script lang="ts">
	/** Shared Contracts list for both roles (design 16e): a plain list page —
	 * no side-by-side detail pane and deliberately no "New contract" button
	 * anywhere. Contracts start in Messages; the empty state points there. */
	import { resolve } from '$app/paths';
	import { listContracts, type ContractSummary } from '$lib/api/contracts';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import { relativeDayLabel } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { notifications } from '$lib/notifications.svelte';
	import { onMount } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	type FamilyFilter = 'all' | 'proposed' | 'active' | 'drafts';
	type ProviderFilter = 'all' | 'awaiting' | 'active';

	let contracts = $state<ContractSummary[]>([]);
	let loading = $state(true);
	let loadError = $state(false);
	let filter = $state<FamilyFilter | ProviderFilter>('all');

	const messagesHref = $derived(
		role === 'family' ? resolve('/family/messages') : resolve('/service-provider/messages')
	);

	const detailHref = (id: string) =>
		role === 'family'
			? resolve('/family/contracts/[id]', { id })
			: resolve('/service-provider/contracts/[id]', { id });

	const filters: Array<{ key: FamilyFilter | ProviderFilter; label: string }> = $derived(
		role === 'family'
			? [
					{ key: 'all', label: m.contracts_filter_all() },
					{ key: 'proposed', label: m.contracts_filter_proposed() },
					{ key: 'active', label: m.contracts_filter_active() },
					{ key: 'drafts', label: m.contracts_filter_drafts() }
				]
			: [
					{ key: 'all', label: m.contracts_filter_all() },
					{ key: 'awaiting', label: m.contracts_filter_awaiting() },
					{ key: 'active', label: m.contracts_filter_active() }
				]
	);

	async function refresh() {
		const result = await listContracts();
		loading = false;
		if (result.ok) {
			contracts = result.data.contracts;
			loadError = false;
		} else if (contracts.length === 0) {
			loadError = true;
		}
	}

	onMount(() => {
		void refresh();
		const contractEvents = [
			'contract.proposed',
			'contract.accepted',
			'contract.declined',
			'contract.changes_requested',
			'contract.ended'
		] as const;
		const unsubscribers = contractEvents.map((type) =>
			notifications.on(type, () => {
				void refresh();
				void contractsBadge.refresh();
			})
		);
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	});

	const matchesFilter = (contract: ContractSummary) => {
		switch (filter) {
			case 'all':
				return true;
			case 'proposed':
				return ['proposed', 'expired', 'changes_requested'].includes(contract.status);
			case 'active':
				return ['active', 'ending'].includes(contract.status);
			case 'drafts':
				return contract.status === 'draft';
			case 'awaiting':
				return contract.awaitingYou;
			default:
				return true;
		}
	};

	const visible = $derived(contracts.filter(matchesFilter));

	const chipFor = (contract: ContractSummary): { status: ChipStatus; label?: string } => {
		if (contract.awaitingYou) return { status: 'awaiting-you' };
		// B5: a contract whose billing is paused reads "Suspended", not "Active".
		if (contract.status === 'active' && contract.billingStatus === 'suspended') {
			return { status: 'suspended' };
		}
		switch (contract.status) {
			case 'changes_requested':
				return { status: 'changes-requested' };
			case 'draft':
			case 'proposed':
			case 'active':
			case 'declined':
			case 'ending':
			case 'ended':
			case 'expired':
				return { status: contract.status };
			default:
				return { status: 'empty', label: contract.status };
		}
	};

	const servicesSummary = (contract: ContractSummary) => {
		const [first, ...rest] = contract.serviceNames;
		if (!first) return m.contracts_list_no_services();
		const name =
			rest.length > 0 ? m.contracts_list_services_more({ name: first, count: rest.length }) : first;
		return contract.weeklyEstimateCents !== null && contract.weeklyEstimateCents > 0
			? m.contracts_list_services_estimate({
					services: name,
					amount: formatMoney(contract.weeklyEstimateCents)
				})
			: name;
	};
</script>

<svelte:head>
	<title>{m.contracts_list_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
		{m.contracts_list_title()}
	</h1>
	<p class="mt-1 mb-5 text-sm text-base-content-muted">
		{#if role === 'family'}
			{m.contracts_list_intro_family_before()}
			<strong class="text-secondary">{m.contracts_list_intro_family_strong()}</strong>
			{m.contracts_list_intro_family_after()}
		{:else}
			{m.contracts_list_intro_provider()}
		{/if}
	</p>

	<div class="mb-4 flex min-w-0 flex-wrap gap-2">
		{#each filters as entry (entry.key)}
			<button
				type="button"
				class={[
					'rounded-pill px-4 py-2 text-[12.5px] font-semibold transition-colors',
					filter === entry.key
						? 'bg-secondary text-secondary-content'
						: 'border-[1.5px] border-outline-variant bg-base-100 text-secondary hover:border-secondary'
				]}
				aria-pressed={filter === entry.key}
				onclick={() => (filter = entry.key)}
			>
				{entry.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if loadError}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<p class="text-sm font-medium text-error" role="alert">{m.contracts_list_load_error()}</p>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => {
					loading = true;
					void refresh();
				}}
			>
				<i class="las la-redo-alt" aria-hidden="true"></i>
				{m.contracts_retry()}
			</button>
		</div>
	{:else if contracts.length === 0}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<span class="flex size-14 items-center justify-center rounded-full bg-base-400">
				<i class="las la-file-signature text-2xl text-neutral" aria-hidden="true"></i>
			</span>
			<h2 class="font-display text-lg font-bold text-base-content">
				{m.contracts_list_empty_title()}
			</h2>
			<p class="max-w-sm text-sm text-base-content-muted">
				{#if role === 'family'}
					{m.contracts_list_empty_family()}
				{:else}
					{m.contracts_list_empty_provider()}
				{/if}
			</p>
			<a href={messagesHref} class="btn btn-primary btn-sm">{m.contracts_list_go_to_messages()}</a>
		</div>
	{:else if visible.length === 0}
		<div class="rounded-xl border border-card-border bg-base-100 p-8 text-center">
			<p class="text-sm text-base-content-muted">{m.contracts_list_filter_empty()}</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border border-card-border bg-base-100">
			<ul>
				{#each visible as contract (contract.id)}
					{@const chip = chipFor(contract)}
					<li class="border-t border-base-200 first:border-t-0">
						<a
							href={detailHref(contract.id)}
							class={[
								'flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-base-200',
								contract.hasNews ? 'border-l-[3px] border-primary bg-base-300/40' : ''
							]}
						>
							<span
								class="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral
									text-sm font-bold text-base-100"
							>
								{contract.counterpart.name.charAt(0).toUpperCase()}
							</span>
							<span class="min-w-0 flex-1">
								<span
									class={[
										'block truncate text-[13.5px] text-base-content',
										contract.hasNews ? 'font-bold' : 'font-semibold'
									]}
								>
									{contract.counterpart.name}
								</span>
								<span class="mt-0.5 block truncate text-[12.5px] text-base-content-muted">
									{servicesSummary(contract)}
								</span>
							</span>
							<StatusChip status={chip.status} label={chip.label} />
							<span class="hidden w-14 shrink-0 text-right text-[11px] text-outline sm:block">
								{relativeDayLabel(contract.updatedAt)}
							</span>
							<i class="las la-angle-right shrink-0 text-outline" aria-hidden="true"></i>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
