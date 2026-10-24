<script lang="ts">
	/** Admin queue of helpers' custom services (UAT #34). Families only see a
	 * custom service once it is approved here; a rejection goes back to the
	 * helper with the reason. */
	import { onMount } from 'svelte';
	import {
		listServicesForReview,
		reviewService,
		type ServiceForReview
	} from '$lib/api/admin-services';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import { formatDate } from '$lib/date';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let services = $state<Array<ServiceForReview>>([]);
	let baseRateCents = $state(0);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);
	const busyIds = new SvelteSet<string>();

	let approving = $state<ServiceForReview | null>(null);
	let rejecting = $state<ServiceForReview | null>(null);
	let rejectReason = $state('');

	async function load() {
		const result = await listServicesForReview();
		if (result.ok) {
			services = result.data.services;
			baseRateCents = result.data.customServiceBaseRateCents;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN'
					? m.admin_custom_error_forbidden()
					: m.admin_custom_error_retry();
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	const perHour = (cents: number) => m.money_per_hour({ amount: formatMoney(cents) });

	const helperName = (service: ServiceForReview) =>
		[service.helper.firstName, service.helper.lastName].filter(Boolean).join(' ') ||
		service.helper.name ||
		service.helper.email;

	async function decide(service: ServiceForReview, decision: 'approve' | 'reject') {
		if (busyIds.has(service.id)) return;
		busyIds.add(service.id);
		const result = await reviewService(service.id, {
			decision,
			reason: decision === 'reject' ? rejectReason.trim() : null
		});
		if (result.ok) {
			toast.success(
				decision === 'approve'
					? m.admin_custom_approved_toast({ name: service.name })
					: m.admin_custom_rejected_toast({ name: service.name })
			);
			approving = null;
			rejecting = null;
			rejectReason = '';
			await load();
		} else {
			toast.error(
				result.error.code === 'SERVICE_REVIEW_NOT_PENDING'
					? m.admin_custom_not_pending()
					: result.error.code === 'SERVICE_REVIEW_REASON_REQUIRED'
						? m.admin_custom_reason_required()
						: m.admin_custom_error_retry(),
				{
					title:
						decision === 'approve'
							? m.admin_custom_not_approved_title({ name: service.name })
							: m.admin_custom_not_rejected_title({ name: service.name })
				}
			);
			if (result.error.code === 'SERVICE_REVIEW_NOT_PENDING') await load();
		}
		busyIds.delete(service.id);
	}
</script>

<svelte:head><title>{m.admin_custom_page_title()}</title></svelte:head>

<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.admin_custom_heading()}</h1>
<p class="mt-1 mb-5 max-w-2xl text-sm text-base-content-muted">
	{m.admin_custom_intro({ rate: perHour(baseRateCents) })}
</p>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if services.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">{m.admin_custom_empty_title()}</p>
		<p class="text-sm text-base-content-muted">{m.admin_custom_empty_body()}</p>
	</div>
{:else}
	<div class="flex flex-col gap-2">
		{#each services as service (service.id)}
			{@const busy = busyIds.has(service.id)}
			<div class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<span class="text-sm font-semibold text-base-content">{service.name}</span>
					<span class="font-display text-sm font-bold text-secondary">
						{perHour(service.hourlyRateCents)}
					</span>
				</div>
				{#if service.description}
					<p class="mt-1 text-[13px] whitespace-pre-line text-base-content">
						{service.description}
					</p>
				{/if}
				<p class="mt-1.5 text-xs text-base-content-muted">
					{m.admin_custom_submitted_meta({
						helper: helperName(service),
						email: service.helper.email,
						date: formatDate(service.updatedAt)
					})}
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={busy}
						onclick={() => (approving = service)}
					>
						{m.admin_custom_approve_ellipsis()}
					</button>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						disabled={busy}
						onclick={() => (rejecting = service)}
					>
						{m.admin_custom_reject_ellipsis()}
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<ConfirmDialog
	open={approving !== null}
	title={m.admin_custom_approve_title({ name: approving?.name ?? '' })}
	body={m.admin_custom_approve_body()}
	confirmLabel={m.admin_custom_approve()}
	confirmClass="btn-primary"
	busy={approving !== null && busyIds.has(approving.id)}
	onconfirm={() => approving && void decide(approving, 'approve')}
	oncancel={() => (approving = null)}
/>

{#if rejecting}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.admin_custom_reject_aria()}
	>
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.admin_custom_reject_heading({ name: rejecting.name })}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">{m.admin_custom_reject_hint()}</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectReason}
				placeholder={m.admin_custom_reject_placeholder()}
			></textarea>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (rejecting = null)}>
					{m.common_cancel()}
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectReason.trim().length === 0 || busyIds.has(rejecting.id)}
					onclick={() => rejecting && void decide(rejecting, 'reject')}
				>
					{m.admin_custom_reject()}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			aria-label={m.common_close()}
			onclick={() => (rejecting = null)}
		></button>
	</div>
{/if}
