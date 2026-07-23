<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		listApprovalRequests,
		type ApprovalQueue,
		type ApprovalQueueEntry
	} from '$lib/api/admin-approvals';
	import StatusChip from '$lib/components/StatusChip.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';
	type Filter = 'needs-action' | 'all' | 'approved' | 'rejected';

	let queue = $state<ApprovalQueue | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');
	let filter = $state<Filter>('needs-action');
	let search = $state('');

	async function load() {
		errorMessage = '';
		const result = await listApprovalRequests();
		if (result.ok) {
			queue = result.data;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHORIZED'
					? 'You need admin access to view the approval queue.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	$effect(() => {
		void load();
	});

	function applicantName(entry: ApprovalQueueEntry): string {
		const name = [entry.applicant.firstName, entry.applicant.lastName].filter(Boolean).join(' ');
		return name || entry.applicant.email;
	}

	function initials(entry: ApprovalQueueEntry): string {
		const first = entry.applicant.firstName?.charAt(0) ?? '';
		const last = entry.applicant.lastName?.charAt(0) ?? '';
		return (first + last).toUpperCase() || entry.applicant.email.charAt(0).toUpperCase();
	}

	function warningsText(entry: ApprovalQueueEntry): string | null {
		const missing = entry.warnings.missingRequiredDocuments;
		const parts: Array<string> = [];
		if (missing.length === 1) parts.push(`${missing[0].name} missing`);
		else if (missing.length > 1) parts.push(`${missing.length} required docs missing`);
		if (entry.warnings.missingServicesOffered) parts.push('no services listed');
		return parts.length > 0 ? parts.join(' · ') : null;
	}

	function waitingText(entry: ApprovalQueueEntry): string {
		if (entry.status !== 'submitted') return '—';
		const ms = Date.now() - new Date(entry.createdAt).getTime();
		const hours = Math.floor(ms / (60 * 60 * 1000));
		if (hours < 1) return 'under an hour';
		if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
		const days = Math.floor(hours / 24);
		return `${days} ${days === 1 ? 'day' : 'days'}`;
	}

	const filtered = $derived.by(() => {
		if (!queue) return [];
		const query = search.trim().toLowerCase();
		return queue.requests.filter((entry) => {
			if (filter === 'needs-action' && entry.status !== 'submitted') return false;
			if (filter === 'approved' && entry.status !== 'approved') return false;
			if (filter === 'rejected' && entry.status !== 'rejected') return false;
			if (query) {
				const haystack = `${applicantName(entry)} ${entry.applicant.email}`.toLowerCase();
				if (!haystack.includes(query)) return false;
			}
			return true;
		});
	});

	const filters = $derived.by((): Array<{ key: Filter; label: string }> => {
		const counts = queue?.counts;
		return [
			{ key: 'needs-action', label: `Needs action${counts ? ` · ${counts.submitted}` : ''}` },
			{ key: 'all', label: `All${counts ? ` · ${counts.total}` : ''}` },
			{ key: 'approved', label: `Approved${counts ? ` · ${counts.approved}` : ''}` },
			{ key: 'rejected', label: `Rejected${counts ? ` · ${counts.rejected}` : ''}` }
		];
	});
</script>

<svelte:head>
	<title>Approval queue · Poppynz admin</title>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Approval queue</h1>
			<p class="mt-1 text-sm text-base-content-muted">
				Provider applications awaiting your decision.
			</p>
		</div>
		<label class="input w-full sm:w-60">
			<i class="las la-search text-base text-outline" aria-hidden="true"></i>
			<input type="search" placeholder="Search by name or email" bind:value={search} />
		</label>
	</div>

	<div class="mt-4 mb-4 flex flex-wrap gap-1.5">
		{#each filters as entry (entry.key)}
			<button
				type="button"
				class="rounded-pill px-4 py-2 text-[12.5px]
					{filter === entry.key
					? 'bg-secondary font-semibold text-secondary-content'
					: 'border border-outline-variant bg-base-100 font-medium text-base-content-muted'}"
				onclick={() => (filter = entry.key)}
			>
				{entry.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if filtered.length === 0}
		<p class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm text-base-content-muted">
			{search.trim() || filter !== 'all'
				? 'No applications match this view.'
				: 'No applications yet.'}
		</p>
	{:else}
		<div
			class="hidden grid-cols-[minmax(200px,260px)_130px_1fr_110px_100px] gap-3.5 px-4 pb-2
				text-[10.5px] font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
		>
			<span>Applicant</span>
			<span>Status</span>
			<span>Warnings</span>
			<span>Waiting</span>
			<span class="text-right">Action</span>
		</div>
		<div class="flex flex-col gap-2">
			{#each filtered as entry (entry.id)}
				{@const warnings = warningsText(entry)}
				<div
					class="rounded-[10px] border border-card-border bg-base-100 p-4
						lg:grid lg:grid-cols-[minmax(200px,260px)_130px_1fr_110px_100px] lg:items-center
						lg:gap-3.5"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<span
							class="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-base-400
								text-[13px] font-bold text-secondary"
						>
							{initials(entry)}
						</span>
						<div class="min-w-0">
							<div class="truncate text-[13.5px] font-semibold text-base-content">
								{applicantName(entry)}
							</div>
							<div class="truncate text-[11.5px] text-outline">{entry.applicant.email}</div>
						</div>
					</div>
					<div class="mt-2 lg:mt-0">
						<StatusChip status={entry.status} />
					</div>
					<div class="mt-2 text-xs lg:mt-0 lg:text-[12.5px]">
						{#if warnings}
							<span class="text-warning">{warnings}</span>
						{:else}
							<span class="text-base-content-muted">No warnings</span>
						{/if}
					</div>
					<div class="mt-1 text-xs text-base-content-muted lg:mt-0 lg:text-[12.5px]">
						{waitingText(entry)}
					</div>
					<div class="mt-3 lg:mt-0 lg:text-right">
						<a
							href={resolve('/admin/approval-requests/[id]', { id: entry.id })}
							class="btn btn-sm {entry.status === 'submitted' ? 'btn-primary' : 'btn-outline'}"
						>
							{entry.status === 'submitted' ? 'Review' : 'View'}
						</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
