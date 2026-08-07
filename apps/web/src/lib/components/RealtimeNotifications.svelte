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
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';
	import { unread } from '$lib/unread.svelte';
	import { onMount } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	let approvalDecision = $state<ApprovalDecision | null>(null);

	const messagesHref = $derived(
		role === 'family' ? resolve('/family/messages') : resolve('/service-provider/messages')
	);
	// Families have no approval page (yet) — for them the modal always shows.
	const approvalHref = $derived(role === 'service-provider' ? resolve('/service-provider/approval') : null);

	const onMessagesPage = () => page.url.pathname.startsWith(messagesHref);
	const onApprovalPage = () => approvalHref !== null && page.url.pathname.startsWith(approvalHref);

	onMount(() => {
		notifications.connect();
		void unread.refresh();
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
