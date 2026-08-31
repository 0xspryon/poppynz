<script lang="ts">
	/** Admin review queue for safety verifications. Nothing here auto-approves —
	 * a Credibled PASS makes a record eligible, a person decides. */
	import { onMount } from 'svelte';
	import {
		decideSafetyVerification,
		listSafetyVerificationsForReview,
		safetyVerificationReportUrl,
		type AdminSafetyVerification
	} from '$lib/api/safety-verification';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { toast } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let items: Array<AdminSafetyVerification> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);
	const busyIds = new SvelteSet<string>();

	let rejecting: AdminSafetyVerification | null = $state<AdminSafetyVerification | null>(null);
	let rejectReason = $state('');
	let rejectBusy = $state(false);

	async function load() {
		loading = true;
		const result = await listSafetyVerificationsForReview();
		if (result.ok) {
			items = result.data.verifications;
			errorMessage = null;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN'
					? 'Your account is not authorized to review safety verifications.'
					: RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	async function approve(item: AdminSafetyVerification) {
		busyIds.add(item.id);
		const result = await decideSafetyVerification(item.id, { decision: 'approve' });
		if (result.ok) {
			toast.success('Verification approved.');
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Not approved' });
		}
		busyIds.delete(item.id);
	}

	async function confirmReject() {
		if (!rejecting || rejectBusy || rejectReason.trim().length === 0) return;
		rejectBusy = true;
		const result = await decideSafetyVerification(rejecting.id, {
			decision: 'reject',
			reason: rejectReason.trim()
		});
		if (result.ok) {
			toast.success('Verification rejected.');
			rejecting = null;
			rejectReason = '';
			await load();
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Not rejected' });
		}
		rejectBusy = false;
	}
</script>

<svelte:head><title>Safety verifications · Poppynz admin</title></svelte:head>

<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Safety verifications</h1>
<p class="mt-1 mb-5 text-sm text-base-content-muted">
	Awaiting a decision. A completed Credibled check is not an approval — review the evidence, then
	decide.
</p>

{#if loading}
	<div class="flex justify-center py-24">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if errorMessage}
	<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">Nothing to review</p>
		<p class="text-sm text-base-content-muted">New submissions will appear here.</p>
	</div>
{:else}
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const busy = busyIds.has(item.id)}
			<div class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5">
				<div class="flex flex-wrap items-center gap-3">
					<StatusChip
						status={item.route === 'credibled' ? 'in-progress' : 'submitted'}
						label={item.route === 'credibled' ? 'Credibled check' : 'Submitted document'}
					/>
					<span class="text-sm font-semibold text-base-content">{item.userId}</span>
					<span class="text-xs text-base-content-muted">
						{item.role === 'family' ? 'Family' : 'Helper'}
					</span>
				</div>

				<dl class="mt-2 grid gap-x-6 gap-y-1 text-xs text-base-content-muted sm:grid-cols-2">
					{#if item.issuingAuthority}
						<div><dt class="inline font-medium">Issuer:</dt> <dd class="inline">{item.issuingAuthority}</dd></div>
					{/if}
					{#if item.documentNumber}
						<div><dt class="inline font-medium">Number:</dt> <dd class="inline">{item.documentNumber}</dd></div>
					{/if}
					{#if item.issuedOn}
						<div><dt class="inline font-medium">Issued:</dt> <dd class="inline">{item.issuedOn}</dd></div>
					{/if}
					{#if item.expiresOn}
						<div><dt class="inline font-medium">Valid until:</dt> <dd class="inline">{item.expiresOn}</dd></div>
					{/if}
					{#if item.consentAt}
						<div>
							<dt class="inline font-medium">Consent:</dt>
							<dd class="inline">{item.consentAt} (policy {item.consentPolicyVersion})</dd>
						</div>
					{/if}
				</dl>

				<div class="mt-3 flex flex-wrap gap-2">
					{#if item.hasCredibledCheck}
						<a
							class="btn btn-outline btn-sm"
							href={safetyVerificationReportUrl(item.id)}
							target="_blank"
							rel="noopener"
						>
							Open report
						</a>
					{/if}
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={busy}
						onclick={() => approve(item)}
					>
						Approve
					</button>
					<button
						type="button"
						class="btn btn-outline btn-error btn-sm"
						disabled={busy}
						onclick={() => (rejecting = item)}
					>
						Reject
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if rejecting}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<div class="modal-box max-w-lg border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">Reject this verification</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				The applicant sees this reason, so make it actionable.
			</p>
			<textarea
				class="textarea w-full"
				rows="3"
				maxlength="500"
				bind:value={rejectReason}
				placeholder="The document was not legible — please upload a clearer scan."
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					onclick={() => (rejecting = null)}
					disabled={rejectBusy}
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-error"
					disabled={rejectBusy || rejectReason.trim().length === 0}
					onclick={confirmReject}
				>
					{#if rejectBusy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Reject
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (rejecting = null)}
			aria-label="Close"
		></button>
	</div>
{/if}
