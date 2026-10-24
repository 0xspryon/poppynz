<script lang="ts">
	/** Shown when a realtime approval event arrives while the user is anywhere
	 * except the approval page itself — the decision is important enough to
	 * interrupt, not just toast. */
	import type { ResolvedPathname } from '$app/types';
	import { intlLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';

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
			? new Date(iso).toLocaleDateString(intlLocale(), {
					year: 'numeric',
					month: 'long',
					day: 'numeric'
				})
			: null;
</script>

{#if decision}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.approval_decision_dialog_label()}
	>
		<div class="modal-box max-w-md border border-card-border text-center">
			{#if decision.kind === 'approved'}
				<span
					class="mx-auto flex size-14 items-center justify-center rounded-full bg-success-content"
				>
					<i class="las la-check-circle text-3xl text-success" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					{m.approval_decision_approved_title()}
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{#if expiryLabel(decision.expiresAt)}
						{m.approval_decision_accepted_until_before()}
						<strong>{expiryLabel(decision.expiresAt)}</strong
						>{m.approval_decision_accepted_until_after()}
					{:else}
						{m.approval_decision_accepted()}
					{/if}
				</p>
			{:else if decision.kind === 'rejected'}
				<span
					class="mx-auto flex size-14 items-center justify-center rounded-full bg-warning-content"
				>
					<i class="las la-info-circle text-3xl text-warning" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					{m.approval_decision_rejected_title()}
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{decision.reason ?? m.approval_decision_rejected_default()}
				</p>
			{:else}
				<span
					class="mx-auto flex size-14 items-center justify-center rounded-full bg-error-content"
				>
					<i class="las la-exclamation-circle text-3xl text-error" aria-hidden="true"></i>
				</span>
				<h3 class="mt-3 font-display text-xl font-bold text-base-content">
					{m.approval_decision_revoked_title()}
				</h3>
				<p class="py-3 text-sm text-base-content-muted">
					{decision.reason ?? m.approval_decision_revoked_default()}
				</p>
			{/if}
			<div class="modal-action justify-center">
				<button type="button" class="btn btn-ghost" onclick={onclose}>{m.common_close()}</button>
				{#if detailsHref}
					<a href={detailsHref} class="btn btn-primary" onclick={onclose}
						>{m.approval_decision_view_details()}</a
					>
				{/if}
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label={m.common_close()}
		></button>
	</div>
{/if}
