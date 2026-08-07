<script lang="ts">
	/** Mounted once per authenticated role layout: opens the SSE notification
	 * stream and turns events into ambient UI — toasts for conversation
	 * activity (suppressed while on the Messages page, which updates itself),
	 * an interrupting modal for approval decisions (suppressed on the approval
	 * page itself), and sidebar unread-badge refreshes via the shared store.
	 *
	 * New notification kinds plug in here: subscribe to the type and choose its
	 * surface (toast, modal, badge) — the transport is already connected. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ApprovalDecisionModal, {
		type ApprovalDecision
	} from '$lib/components/ApprovalDecisionModal.svelte';
	import ContractDecisionModal, {
		type ContractDecision
	} from '$lib/components/ContractDecisionModal.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import { formatDateWithWeekday } from '$lib/date';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';
	import { unread } from '$lib/unread.svelte';
	import { onMount } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	let approvalDecision = $state<ApprovalDecision | null>(null);
	let contractDecision = $state<ContractDecision | null>(null);

	const messagesHref = $derived(
		role === 'family' ? resolve('/family/messages') : resolve('/service-provider/messages')
	);
	// Families have no approval page (yet) — for them the modal always shows.
	const approvalHref = $derived(role === 'service-provider' ? resolve('/service-provider/approval') : null);
	const contractsHref = $derived(
		role === 'family' ? resolve('/family/contracts') : resolve('/service-provider/contracts')
	);
	const contractDetailHref = (id: string) =>
		role === 'family'
			? resolve('/family/contracts/[id]', { id })
			: resolve('/service-provider/contracts/[id]', { id });

	const onMessagesPage = () => page.url.pathname.startsWith(messagesHref);
	const onApprovalPage = () => approvalHref !== null && page.url.pathname.startsWith(approvalHref);
	const onContractsPage = () => page.url.pathname.startsWith(contractsHref);

	onMount(() => {
		notifications.connect();
		void unread.refresh();
		void contractsBadge.refresh();
		const unsubscribers = [
			notifications.on('conversation.reachout', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.info(`${event.payload.senderName} would like to work with you.`, {
						title: 'New reach-out'
					});
				}
			}),
			notifications.on('conversation.message', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.info(event.payload.preview, {
						title: `New message from ${event.payload.senderName}`
					});
				}
			}),
			notifications.on('conversation.unlocked', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.success(`${event.payload.responderName} responded — your conversation is unlocked.`, {
						title: 'Reach-out accepted'
					});
				}
			}),
			notifications.on('approval.decided', (event) => {
				if (onApprovalPage()) {
					toast.info(
						event.payload.status === 'approved'
							? 'Your approval request was accepted.'
							: 'Your approval request was declined.',
						{ title: 'Approval update' }
					);
					return;
				}
				approvalDecision =
					event.payload.status === 'approved'
						? { kind: 'approved', expiresAt: event.payload.expiresAt }
						: { kind: 'rejected', reason: event.payload.reason };
			}),
			notifications.on('approval.revoked', (event) => {
				if (onApprovalPage()) {
					toast.error('Your approval was revoked.', { title: 'Approval update' });
					return;
				}
				approvalDecision = { kind: 'revoked', reason: event.payload.reason };
			}),
			notifications.on('contract.proposed', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					toast.info(
						event.payload.isAmendment
							? `${event.payload.counterpartName} proposed new terms on your contract.`
							: `${event.payload.counterpartName} sent you contract terms to review.`,
						{ title: event.payload.isAmendment ? 'Contract amendment' : 'New contract proposal' }
					);
				}
			}),
			notifications.on('contract.accepted', (event) => {
				void contractsBadge.refresh();
				if (onContractsPage()) {
					toast.success(
						event.payload.isAmendment
							? `${event.payload.counterpartName} accepted the new terms.`
							: `${event.payload.counterpartName} accepted & signed your proposal.`,
						{ title: 'Contract update' }
					);
					return;
				}
				contractDecision = {
					kind: 'accepted',
					contractId: event.payload.contractId,
					counterpartName: event.payload.counterpartName,
					isAmendment: event.payload.isAmendment
				};
			}),
			notifications.on('contract.declined', (event) => {
				void contractsBadge.refresh();
				if (onContractsPage()) {
					toast.info(
						`${event.payload.counterpartName} declined ${event.payload.isAmendment ? 'the new terms' : 'your proposal'}.`,
						{ title: 'Contract update' }
					);
					return;
				}
				contractDecision = {
					kind: 'declined',
					contractId: event.payload.contractId,
					counterpartName: event.payload.counterpartName,
					reason: event.payload.reason,
					isAmendment: event.payload.isAmendment
				};
			}),
			notifications.on('contract.changes_requested', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					toast.info(`${event.payload.counterpartName} asked for changes to your proposal.`, {
						title: 'Contract update'
					});
				}
			}),
			notifications.on('contract.ended', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					toast.info(
						`${event.payload.counterpartName} gave 2 weeks' notice — last working day ${formatDateWithWeekday(event.payload.endsOn)}.`,
						{ title: 'Contract ending' }
					);
				}
			})
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
			notifications.disconnect();
		};
	});
</script>

<ApprovalDecisionModal
	decision={approvalDecision}
	detailsHref={approvalHref}
	onclose={() => (approvalDecision = null)}
/>

<ContractDecisionModal
	decision={contractDecision}
	detailsHref={contractDecision ? contractDetailHref(contractDecision.contractId) : null}
	onclose={() => (contractDecision = null)}
/>
