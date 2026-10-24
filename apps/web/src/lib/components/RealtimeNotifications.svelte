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
	import { formatEndTime } from '$lib/contract-sessions';
	import { notifications } from '$lib/notifications.svelte';
	import { m } from '$lib/paraglide/messages';
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
	// Helpers have one Verification page in place of Documents / Approval.
	const approvalHref = $derived(
		role === 'family' ? resolve('/family/approval') : resolve('/service-provider/verification')
	);
	const contractsHref = $derived(
		role === 'family' ? resolve('/family/contracts') : resolve('/service-provider/contracts')
	);
	const verificationHref = $derived(
		role === 'family' ? resolve('/family/verification') : resolve('/service-provider/verification')
	);
	const documentsHref = $derived(
		role === 'family' ? resolve('/family/documents') : resolve('/service-provider/verification')
	);
	const contractDetailHref = (id: string) =>
		role === 'family'
			? resolve('/family/contracts/[id]', { id })
			: resolve('/service-provider/contracts/[id]', { id });
	const vouchesHref = $derived(
		role === 'family' ? resolve('/family/vouches') : resolve('/service-provider/vouches')
	);

	const onMessagesPage = () => page.url.pathname.startsWith(messagesHref);
	const onApprovalPage = () => page.url.pathname.startsWith(approvalHref);
	const onContractsPage = () => page.url.pathname.startsWith(contractsHref);
	const onVouchesPage = () => page.url.pathname.startsWith(vouchesHref);
	// Both pages subscribe themselves and refetch; a toast there would be noise.
	const onVerificationPage = () =>
		page.url.pathname.startsWith(verificationHref) || page.url.pathname.startsWith(documentsHref);

	const verificationCopy: Record<string, { title: string; message: string }> = {
		invited: {
			title: m.notify_verification_invited_title(),
			message: m.notify_verification_invited_message()
		},
		in_progress: {
			title: m.notify_verification_in_progress_title(),
			message: m.notify_verification_in_progress_message()
		},
		review_required: {
			title: m.notify_verification_review_title(),
			message: m.notify_verification_review_message()
		},
		verified: {
			title: m.notify_verification_verified_title(),
			message: m.notify_verification_verified_message()
		},
		rejected: {
			title: m.notify_verification_rejected_title(),
			message: m.notify_verification_rejected_message()
		}
	};

	onMount(() => {
		notifications.connect();
		void unread.refresh();
		void contractsBadge.refresh();
		const unsubscribers = [
			notifications.on('conversation.reachout', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.info(m.notify_reachout_message({ name: event.payload.senderName }), {
						title: m.notify_reachout_title()
					});
				}
			}),
			notifications.on('conversation.message', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.info(event.payload.preview, {
						title: m.notify_message_title({ name: event.payload.senderName })
					});
				}
			}),
			notifications.on('conversation.unlocked', (event) => {
				void unread.refresh();
				if (!onMessagesPage()) {
					toast.success(m.notify_unlocked_message({ name: event.payload.responderName }), {
						title: m.notify_unlocked_title()
					});
				}
			}),
			notifications.on('approval.decided', (event) => {
				if (onApprovalPage()) {
					toast.info(
						event.payload.status === 'approved'
							? m.notify_approval_accepted()
							: m.notify_approval_declined(),
						{ title: m.notify_approval_title() }
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
					toast.error(m.notify_approval_revoked(), { title: m.notify_approval_title() });
					return;
				}
				approvalDecision = { kind: 'revoked', reason: event.payload.reason };
			}),
			notifications.on('contract.proposed', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					toast.info(m.notify_contract_proposed_message({ name: event.payload.counterpartName }), {
						title: m.notify_contract_proposed_title()
					});
				}
			}),
			notifications.on('contract.accepted', (event) => {
				void contractsBadge.refresh();
				if (onContractsPage()) {
					toast.success(
						m.notify_contract_accepted_message({ name: event.payload.counterpartName }),
						{
							title: m.notify_contract_update_title()
						}
					);
					return;
				}
				contractDecision = {
					kind: 'accepted',
					contractId: event.payload.contractId,
					counterpartName: event.payload.counterpartName
				};
			}),
			notifications.on('contract.declined', (event) => {
				void contractsBadge.refresh();
				if (onContractsPage()) {
					toast.info(m.notify_contract_declined_message({ name: event.payload.counterpartName }), {
						title: m.notify_contract_update_title()
					});
					return;
				}
				contractDecision = {
					kind: 'declined',
					contractId: event.payload.contractId,
					counterpartName: event.payload.counterpartName,
					reason: event.payload.reason
				};
			}),
			notifications.on('contract.changes_requested', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					toast.info(m.notify_contract_changes_message({ name: event.payload.counterpartName }), {
						title: m.notify_contract_update_title()
					});
				}
			}),
			notifications.on('safety_verification.updated', (event) => {
				if (onVerificationPage()) return;
				const copy = verificationCopy[event.payload.status];
				if (!copy) return;
				if (event.payload.status === 'rejected') {
					toast.error(copy.message, { title: copy.title });
				} else if (event.payload.status === 'verified') {
					toast.success(copy.message, { title: copy.title });
				} else {
					toast.info(copy.message, { title: copy.title });
				}
			}),
			notifications.on('vouch.requested', (event) => {
				if (onVouchesPage()) return;
				toast.info(m.notify_vouch_requested_message({ name: event.payload.applicantName }), {
					title: m.notify_vouch_requested_title()
				});
			}),
			notifications.on('contract.ended', (event) => {
				void contractsBadge.refresh();
				if (!onContractsPage()) {
					const name = event.payload.counterpartName;
					const date = formatDateWithWeekday(event.payload.endsOn);
					toast.info(
						event.payload.endsAtMinutes
							? m.notify_contract_ended_until_message({
									name,
									date,
									time: formatEndTime(event.payload.endsAtMinutes)
								})
							: m.notify_contract_ended_message({ name, date }),
						{ title: m.notify_contract_ended_title() }
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
