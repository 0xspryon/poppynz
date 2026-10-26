<script lang="ts">
	/** "View signed agreement" on the contract page, for both parties. */
	import { m } from '$lib/paraglide/messages';
	import SignedAgreementView from './SignedAgreementView.svelte';

	let { open, contractId, onclose }: { open: boolean; contractId: string; onclose: () => void } =
		$props();
</script>

{#if open}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.agreement_signed_title()}
	>
		<div class="modal-box flex max-h-[90vh] max-w-3xl flex-col border border-card-border p-0">
			<div class="flex items-center justify-between border-b border-base-300 px-6 py-4">
				<h2 class="font-display text-lg font-bold text-base-content">
					{m.agreement_signed_title()}
				</h2>
				<button
					type="button"
					class="btn btn-square btn-ghost btn-sm"
					aria-label={m.common_close()}
					onclick={onclose}
				>
					<i class="las la-times text-lg" aria-hidden="true"></i>
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
				<SignedAgreementView {contractId} />
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label={m.common_close()}
		></button>
	</div>
{/if}
