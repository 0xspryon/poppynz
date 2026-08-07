<script lang="ts" module>
	export type ContractDecision =
		| { kind: 'accepted'; contractId: string; counterpartName: string; isAmendment: boolean }
		| {
				kind: 'declined';
				contractId: string;
				counterpartName: string;
				reason: string | null;
				isAmendment: boolean;
		  };
</script>

<script lang="ts">
	/** Shown when a realtime contract decision arrives while the user is
	 * anywhere except the contracts pages — accept/decline is important enough
	 * to interrupt, not just toast (mirrors ApprovalDecisionModal). */
	import type { ResolvedPathname } from '$app/types';

	interface Props {
		decision: ContractDecision | null;
		/** Link to the decided contract's detail page. */
		detailsHref?: ResolvedPathname | null;
		onclose: () => void;
	}

	let { decision, detailsHref = null, onclose }: Props = $props();
</script>

{#if decision}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Contract update">
		<div class="modal-box max-w-md border border-card-border text-center">
			{#if decision.kind === 'accepted'}
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-success-content">
					<i class="las la-file-signature text-3xl text-success" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					{decision.isAmendment ? 'Amendment accepted' : 'Contract signed!'}
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{#if decision.isAmendment}
						{decision.counterpartName} accepted the new terms — they're now in effect.
					{:else}
						{decision.counterpartName} accepted &amp; signed your proposal. Contact details are now
						shared and payments run on Poppynz.
					{/if}
				</p>
			{:else}
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-base-300">
					<i class="las la-file-alt text-3xl text-neutral" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					{decision.isAmendment ? 'Amendment declined' : 'Proposal declined'}
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{decision.counterpartName} declined
					{decision.isAmendment ? 'the new terms — the current ones stay in effect' : 'your proposal'}{decision.reason
						? `: “${decision.reason}”`
						: '.'}
					Your chat stays open{decision.isAmendment ? '.' : ' — you can propose new terms any time.'}
				</p>
			{/if}
			<div class="modal-action justify-center">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Close</button>
				{#if detailsHref}
					<a href={detailsHref} class="btn btn-primary" onclick={onclose}>View contract</a>
				{/if}
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label="Close"></button>
	</div>
{/if}
