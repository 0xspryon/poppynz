<script lang="ts">
	/** The newest service agreement signatures, on the admin template page
	 * (UAT round 2, item 4); each links to the contract's signed agreement. */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		listAgreementSignatures,
		shortHash,
		type AdminAgreementSignature
	} from '$lib/api/agreements';
	import { formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	let signatures = $state<Array<AdminAgreementSignature>>([]);
	let loading = $state(true);

	onMount(() => {
		void listAgreementSignatures().then((result) => {
			loading = false;
			if (result.ok) signatures = result.data;
			else toast.error(m.agreement_admin_signatures_load_failed());
		});
	});
</script>

<h2 class="mt-8 mb-3 font-display text-lg font-bold text-base-content">
	{m.agreement_admin_signatures_heading()}
</h2>
{#if loading}
	<div class="flex justify-center py-6">
		<span class="loading loading-spinner loading-md text-primary"></span>
	</div>
{:else if signatures.length === 0}
	<p class="text-sm text-base-content-muted">{m.agreement_admin_signatures_empty()}</p>
{:else}
	<div class="flex flex-col gap-2">
		{#each signatures as signature (signature.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3 lg:grid
					lg:grid-cols-[110px_1fr_200px_90px] lg:items-center lg:gap-3.5"
			>
				<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
					{signature.side === 'family' ? m.agreement_side_family() : m.agreement_side_helper()}
				</span>
				<div class="min-w-0 py-1 lg:py-0">
					<p class="truncate text-sm text-base-content">
						{signature.signerName}
						<span class="text-base-content-muted">· {signature.signerEmail}</span>
					</p>
					<p class="truncate font-mono text-[11px] text-base-content-muted">
						{m.agreement_signed_meta({
							template: signature.templateVersion,
							terms: signature.contractVersion,
							language:
								signature.locale === 'fr' ? m.agreement_language_fr() : m.agreement_language_en(),
							hash: shortHash(signature.sha256)
						})}
					</p>
				</div>
				<p class="text-[12px] text-base-content-muted">
					{formatDateTime(signature.signedAt)}
					{#if signature.voidedAt}
						<span class="block font-semibold text-warning">{m.agreement_signed_voided()}</span>
					{/if}
				</p>
				<div class="mt-2 flex justify-end lg:mt-0">
					<a
						class="btn btn-ghost btn-sm"
						href={resolve('/admin/contracts/[id]/agreement', { id: signature.contractId })}
					>
						{m.common_view()}
					</a>
				</div>
			</div>
		{/each}
	</div>
{/if}
