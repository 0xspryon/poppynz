<script lang="ts">
	/** Shown when a realtime approval event arrives while the user is anywhere
	 * except the approval page itself — the decision is important enough to
	 * interrupt, not just toast. */
	import type { ResolvedPathname } from '$app/types';

	export type ApprovalDecision =
		| { kind: 'approved'; expiresAt: string | null }
		| { kind: 'rejected'; reason: string | null }
		| { kind: 'revoked'; reason: string | null };

	interface Props {
		decision: ApprovalDecision | null;
		/** Link to the page with the full approval state, when the role has one. */
		detailsHref?: ResolvedPathname | null;
		onclose: () => void;
	}

	let { decision, detailsHref = null, onclose }: Props = $props();

	const expiryLabel = (iso: string | null) =>
		iso
			? new Date(iso).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				})
			: null;
</script>

{#if decision}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Approval update">
		<div class="modal-box max-w-md border border-card-border text-center">
			{#if decision.kind === 'approved'}
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-success-content">
					<i class="las la-check-circle text-3xl text-success" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">You're approved!</h3>
				<p class="py-3 text-sm text-base-content-muted">
					Your approval request was accepted
					{#if expiryLabel(decision.expiresAt)}
						— your approval is valid until <strong>{expiryLabel(decision.expiresAt)}</strong>{/if}.
				</p>
			{:else if decision.kind === 'rejected'}
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-warning-content">
					<i class="las la-info-circle text-3xl text-warning" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					Approval request declined
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{decision.reason ?? 'Our review team declined your approval request.'}
				</p>
			{:else}
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-error-content">
					<i class="las la-exclamation-circle text-3xl text-error" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">Approval revoked</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{decision.reason ?? 'Your approval was revoked by the Poppynz team.'}
				</p>
			{/if}
			<div class="modal-action justify-center">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Close</button>
				{#if detailsHref}
					<a href={detailsHref} class="btn btn-primary" onclick={onclose}>View details</a>
				{/if}
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label="Close"></button>
	</div>
{/if}
