<script lang="ts">
	/** An admin's read of a contract's signed service agreement (UAT round 2,
	 * item 4) — through the contract review permission. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SignedAgreementView from '$lib/components/contracts/SignedAgreementView.svelte';
	import { m } from '$lib/paraglide/messages';

	const contractId = $derived(page.params.id ?? '');
</script>

<svelte:head>
	<title>{m.agreement_admin_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-4xl">
	<a
		href={resolve('/admin/tcs')}
		class="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		{m.admin_tcs_heading()}
	</a>
	<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
		{m.agreement_signed_title()}
	</h1>
	<p class="mb-5 font-mono text-[12px] text-base-content-muted">
		{m.agreement_admin_contract_ref({ id: contractId })}
	</p>
	{#if contractId}
		<SignedAgreementView {contractId} />
	{/if}
</div>
