<script lang="ts">
	/** The admin dispute queue (Tier 3): contested session resolutions, oldest
	 * first, and the decided ones for reference. Gated by the `sessionDispute`
	 * permission on the API. */
	import { resolve } from '$app/paths';
	import { listSessionDisputes, type SessionDisputeSummary } from '$lib/api/session-disputes';
	import { formatSessionRange } from '$lib/contract-sessions';
	import { formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { resolutionKindLabel } from '$lib/session-resolution';

	let status = $state<'contested' | 'decided'>('contested');
	let items = $state<Array<SessionDisputeSummary>>([]);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	let seq = 0;
	async function load(which: 'contested' | 'decided') {
		seq += 1;
		const mine = seq;
		loading = true;
		const result = await listSessionDisputes(which);
		if (mine !== seq) return;
		loading = false;
		if (result.ok) {
			items = result.data.disputes;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN'
					? m.admin_disputes_error_forbidden()
					: m.admin_disputes_error_load();
		}
	}

	$effect(() => {
		void load(status);
	});

	const range = (dispute: SessionDisputeSummary) =>
		formatSessionRange({
			weekday: 0,
			startMinutes: dispute.session.startMinutes,
			endMinutes: dispute.session.endMinutes
		});
</script>

<svelte:head>
	<title>{m.admin_disputes_page_title()}</title>
</svelte:head>

<div class="mb-6">
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.admin_disputes_heading()}
	</h1>
	<p class="text-sm text-base-content-muted">{m.admin_disputes_intro()}</p>
</div>

<div role="tablist" class="tabs-border mb-4 tabs">
	<button
		type="button"
		role="tab"
		class={['tab', status === 'contested' && 'tab-active']}
		aria-selected={status === 'contested'}
		onclick={() => (status = 'contested')}
	>
		{m.admin_disputes_tab_open()}
	</button>
	<button
		type="button"
		role="tab"
		class={['tab', status === 'decided' && 'tab-active']}
		aria-selected={status === 'decided'}
		onclick={() => (status = 'decided')}
	>
		{m.admin_disputes_tab_decided()}
	</button>
</div>

{#if errorMessage}
	<p
		class="mb-5 flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content px-4 py-3 text-sm font-medium text-error"
		role="alert"
	>
		<i class="las la-exclamation-circle text-base" aria-hidden="true"></i>
		{errorMessage}
	</p>
{/if}

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-lg loading-spinner text-primary"></span>
	</div>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="text-sm text-base-content-muted">
			{status === 'contested' ? m.admin_disputes_empty_open() : m.admin_disputes_empty_decided()}
		</p>
	</div>
{:else}
	<ul class="flex flex-col gap-2" data-testid="session-disputes">
		{#each items as dispute (dispute.id)}
			<li
				class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-card-border bg-base-100 px-4 py-3"
			>
				<div class="min-w-0 flex-1">
					<p class="font-semibold text-base-content">
						{resolutionKindLabel(dispute.kind)} · {dispute.session.serviceName}
					</p>
					<p class="text-[12.5px] text-base-content-muted">
						{formatDateWithWeekday(dispute.session.date)} · {range(dispute)} ({dispute.session
							.timeZoneLabel})
					</p>
					<p class="text-[12px] text-outline">
						{m.admin_disputes_parties({ family: dispute.familyName, helper: dispute.helperName })}
						· {m.admin_disputes_updated({ when: formatDateTime(dispute.updatedAt) })}
					</p>
				</div>
				<a
					class="btn btn-sm btn-primary"
					href={resolve('/admin/session-disputes/[id]', { id: dispute.id })}
				>
					{status === 'contested' ? m.admin_disputes_review() : m.admin_disputes_view()}
				</a>
			</li>
		{/each}
	</ul>
{/if}
