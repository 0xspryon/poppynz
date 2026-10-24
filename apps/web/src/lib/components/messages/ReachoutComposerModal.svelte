<script lang="ts">
	/** Reach-out composer (design 16a). The intro message is fixed — the same
	 * for everyone, so receivers never screen free-text from strangers — and the
	 * sender only picks which of the receiver-relevant services apply: a family
	 * picks from the provider's offering, a provider from the family's needs.
	 * The server renders the canonical message; the preview here mirrors it. */
	import { createReachout } from '$lib/api/conversations';
	import { getProfile } from '$lib/api/provider-profile';
	import { matchError } from '$lib/api/client';
	import { toast } from '$lib/toast.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		onclose: () => void;
		recipient: { userId: string; name: string };
		services: Array<{ id: string; name: string }>;
		senderRole: 'family' | 'service-provider';
		/** Called with the conversation id after a successful send, or when a
		 * conversation with this person already exists. */
		onconversation: (conversationId: string) => void;
	}

	let { open, onclose, recipient, services, senderRole, onconversation }: Props = $props();

	let selected = $state<string[]>([]);
	let sending = $state(false);
	let senderCity = $state<string | null>(null);

	const firstName = $derived(recipient.name.split(/\s+/)[0] ?? '');
	const initial = $derived(firstName.charAt(0).toUpperCase());

	// Mirrors the server-side template (conversations.handler.ts).
	const previewMessage = $derived.by(() => {
		if (senderRole === 'family') {
			return senderCity
				? m.messages_composer_preview_family_city({ name: firstName, city: senderCity })
				: m.messages_composer_preview_family({ name: firstName });
		}
		return senderCity
			? m.messages_composer_preview_provider_city({ name: firstName, city: senderCity })
			: m.messages_composer_preview_provider({ name: firstName });
	});

	const approvalNeededMessage = () =>
		senderRole === 'family'
			? m.messages_error_approval_needed_reachout_family()
			: m.messages_error_approval_needed_reachout_provider();

	$effect(() => {
		if (!open) return;
		selected = [];
		void getProfile().then((result) => {
			if (result.ok) senderCity = result.data.city ?? null;
		});
	});

	function toggle(serviceId: string) {
		selected = selected.includes(serviceId)
			? selected.filter((id) => id !== serviceId)
			: [...selected, serviceId];
	}

	async function send() {
		if (sending || selected.length === 0) return;
		sending = true;
		const result = await createReachout({
			recipientUserId: recipient.userId,
			serviceIds: selected
		});
		sending = false;
		if (result.ok) {
			toast.success(m.messages_composer_sent_body({ name: firstName }), {
				title: m.messages_composer_sent_title()
			});
			onconversation(result.data.id);
			onclose();
			return;
		}
		const genericError = () => toast.error(m.messages_composer_error_generic());
		matchError(result.error, {
			CONVERSATION_EXISTS: (error) => {
				onconversation(error.conversationId);
				onclose();
			},
			REACHOUT_UNAVAILABLE: () => toast.error(m.messages_composer_error_reachout_unavailable()),
			INVALID_REACHOUT_SERVICES: () => toast.error(m.messages_composer_error_invalid_services()),
			INVALID_REACHOUT_INPUT: () => toast.error(m.messages_composer_error_invalid_input()),
			RECIPIENT_NOT_FOUND: () => toast.error(m.messages_composer_error_recipient_not_found()),
			CONVERSATION_PAIR_INVALID: () => toast.error(m.messages_composer_error_pair_invalid()),
			PROVIDER_NOT_APPROVED: () => toast.error(approvalNeededMessage()),
			FAMILY_NOT_APPROVED: () => toast.error(approvalNeededMessage()),
			APPROVAL_UNAVAILABLE: () => toast.error(m.messages_error_approval_unavailable()),
			// Safety verification gates both roles, so this can fire for a family
			// as well as a helper — send them to the screen that fixes it.
			SAFETY_VERIFICATION_REQUIRED: () => toast.error(m.messages_error_safety_required()),
			SAFETY_VERIFICATION_UNAVAILABLE: () => toast.error(m.messages_error_safety_unavailable()),
			UNAUTHORIZED: () => toast.error(m.messages_composer_error_sign_in_again()),
			FORBIDDEN: () => toast.error(m.messages_composer_error_forbidden()),
			// Codes below belong to sibling /conversations endpoints (they share
			// one error union) or are transport-level — all generic here.
			CONVERSATION_LOOKUP_FAILED: genericError,
			COUNTERPART_UNAVAILABLE: genericError,
			AUTH_PROVIDER_FAILED: genericError,
			AUTH_ENTITY_LOOKUP_FAILED: genericError,
			INTERNAL_SERVER_ERROR: genericError,
			INVALID_MESSAGE_INPUT: genericError,
			INVALID_CONVERSATION_ID: genericError,
			INVALID_LOOKUP_INPUT: genericError,
			CONVERSATION_NOT_FOUND: genericError,
			CONVERSATION_NOT_PENDING: genericError,
			NOT_CONVERSATION_RECEIVER: genericError,
			CONVERSATION_LOCKED: genericError,
			UNEXPECTED: genericError
		});
	}
</script>

{#if open}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.messages_composer_title({ name: recipient.name })}
	>
		<div class="modal-box max-w-xl border border-card-border p-0">
			<div class="flex items-center gap-2.5 border-b border-base-300 px-6 py-4">
				<span
					class="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral text-sm
						font-bold text-base-100"
				>
					{initial}
				</span>
				<h2 class="font-display text-base font-bold text-base-content">
					{m.messages_composer_title({ name: recipient.name })}
				</h2>
				<button
					type="button"
					class="btn ml-auto btn-circle btn-ghost btn-sm"
					aria-label={m.common_close()}
					onclick={onclose}
				>
					<i class="las la-times text-lg" aria-hidden="true"></i>
				</button>
			</div>

			<div class="flex flex-col gap-4 px-6 py-4">
				<div>
					<div class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{m.messages_composer_your_message()}
					</div>
					<div
						class="flex items-start gap-2 rounded-lg border border-outline-variant/60 bg-base-200
							px-3.5 py-3 text-[13.5px] leading-relaxed text-base-content-muted"
					>
						<i class="las la-lock mt-0.5 shrink-0 text-outline" aria-hidden="true"></i>
						<span>{previewMessage}</span>
					</div>
					<p class="mt-1 text-[11px] text-outline">
						{m.messages_composer_standard_note()}
					</p>
				</div>

				<div>
					<div class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{senderRole === 'family'
							? m.messages_composer_services_family()
							: m.messages_composer_services_provider()}
						<span class="font-normal normal-case tracking-normal">
							{senderRole === 'family'
								? m.messages_composer_services_from_offering({ name: firstName })
								: m.messages_composer_services_from_needs({ name: firstName })}
						</span>
					</div>
					<div class="flex flex-wrap gap-2">
						{#each services as service (service.id)}
							{@const active = selected.includes(service.id)}
							<button
								type="button"
								class={[
									'inline-flex items-center gap-1.5 rounded-pill border-[1.5px] px-3.5 py-1.5',
									'text-[12.5px] font-semibold transition-colors',
									active
										? 'border-secondary bg-secondary text-secondary-content'
										: 'border-outline-variant bg-base-100 text-secondary hover:border-secondary'
								]}
								aria-pressed={active}
								onclick={() => toggle(service.id)}
							>
								{#if active}
									<i class="las la-check" aria-hidden="true"></i>
								{/if}
								{service.name}
							</button>
						{/each}
					</div>
				</div>

				<div
					class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-3.5 py-2.5"
				>
					<i class="las la-user-shield mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
					<p class="text-xs leading-relaxed text-neutral">
						{m.messages_composer_privacy_before({ name: firstName })}
						<strong
							>{senderRole === 'family'
								? m.messages_composer_privacy_family_profile()
								: m.messages_composer_privacy_profile()}</strong
						>
						{m.messages_composer_privacy_after()}
					</p>
				</div>
			</div>

			<div class="flex items-center gap-2.5 px-6 pt-1 pb-5">
				<button
					type="button"
					class="btn btn-primary"
					disabled={sending || selected.length === 0}
					onclick={send}
				>
					{#if sending}
						<span class="loading loading-sm loading-spinner"></span>
					{/if}
					{m.messages_composer_send()}
				</button>
				<button type="button" class="btn btn-ghost" onclick={onclose}>{m.common_cancel()}</button>
				<span class="ml-auto text-[11px] text-outline">{m.messages_composer_can_respond({ name: firstName })}</span>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label={m.common_close()}></button>
	</div>
{/if}
