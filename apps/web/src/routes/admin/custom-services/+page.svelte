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
	import { centsToDollars } from '$lib/money';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

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
					? 'Your account is not authorized to review services.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

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
					? `${service.name} approved — families can now see it.`
					: `${service.name} rejected.`
			);
			approving = null;
			rejecting = null;
			rejectReason = '';
			await load();
		} else {
			toast.error(
				result.error.code === 'SERVICE_REVIEW_NOT_PENDING' ||
					result.error.code === 'SERVICE_REVIEW_REASON_REQUIRED'
					? result.error.message
					: RETRY_MESSAGE,
				{ title: `${service.name} not ${decision === 'approve' ? 'approved' : 'rejected'}` }
			);
			if (result.error.code === 'SERVICE_REVIEW_NOT_PENDING') await load();
		}
		busyIds.delete(service.id);
	}
</script>

<svelte:head><title>Custom services · Poppynz admin</title></svelte:head>

<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Custom services</h1>
<p class="mt-1 mb-5 max-w-2xl text-sm text-base-content-muted">
	Services helpers described themselves. Families see one only after you approve it. Reject anything
	that is really personal care — that is the Personal support (PSW) service, which needs an approved
	PSW credential. Custom services start at the ${centsToDollars(baseRateCents)}/hr base rate.
</p>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if services.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">Nothing to review</p>
		<p class="text-sm text-base-content-muted">New custom services will appear here.</p>
	</div>
{:else}
	<div class="flex flex-col gap-2">
		{#each services as service (service.id)}
			{@const busy = busyIds.has(service.id)}
			<div class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<span class="text-sm font-semibold text-base-content">{service.name}</span>
					<span class="font-display text-sm font-bold text-secondary">
						${centsToDollars(service.hourlyRateCents)}/hr
					</span>
				</div>
				{#if service.description}
					<p class="mt-1 text-[13px] whitespace-pre-line text-base-content">
						{service.description}
					</p>
				{/if}
				<p class="mt-1.5 text-xs text-base-content-muted">
					{helperName(service)} · {service.helper.email} · submitted {formatDate(service.updatedAt)}
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={busy}
						onclick={() => (approving = service)}
					>
						Approve…
					</button>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						disabled={busy}
						onclick={() => (rejecting = service)}
					>
						Reject…
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<ConfirmDialog
	open={approving !== null}
	title="Approve {approving?.name}?"
	body="Families will be able to find and book this service."
	confirmLabel="Approve"
	confirmClass="btn-primary"
	busy={approving !== null && busyIds.has(approving.id)}
	onconfirm={() => approving && void decide(approving, 'approve')}
	oncancel={() => (approving = null)}
/>

{#if rejecting}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Reject service">
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">Reject {rejecting.name}</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">The helper sees this reason.</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectReason}
				placeholder="This describes personal care — add the Personal support (PSW) service instead."
			></textarea>
			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={() => (rejecting = null)}>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectReason.trim().length === 0 || busyIds.has(rejecting.id)}
					onclick={() => rejecting && void decide(rejecting, 'reject')}
				>
					Reject
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			aria-label="Close"
			onclick={() => (rejecting = null)}
		></button>
	</div>
{/if}
