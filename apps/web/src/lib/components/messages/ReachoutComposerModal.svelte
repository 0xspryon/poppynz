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

	const firstName = $derived(recipient.name.split(/\s+/)[0] ?? 'there');
	const initial = $derived(firstName.charAt(0).toUpperCase());

	// Mirrors the server-side template (conversations.handler.ts).
	const previewMessage = $derived.by(() => {
		const location = senderCity
			? senderRole === 'family'
				? ` We're in ${senderCity}.`
				: ` I'm in ${senderCity}.`
			: '';
		const closing =
			senderRole === 'family'
				? ' Take a look at my family profile and the services we need below.'
				: ' Take a look at my profile and the services I offer below.';
		return `Hi ${firstName} — I'd like to work with you.${location}${closing}`;
	});

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
			toast.success(`${firstName} can now respond to your reach-out.`, { title: 'Reach-out sent' });
			onconversation(result.data.id);
			onclose();
			return;
		}
		const genericError = () => toast.error('The reach-out could not be sent. Please try again.');
		matchError(result.error, {
			CONVERSATION_EXISTS: (error) => {
				onconversation(error.conversationId);
				onclose();
			},
			REACHOUT_UNAVAILABLE: (error) => toast.error(error.message),
			INVALID_REACHOUT_SERVICES: (error) => toast.error(error.message),
			INVALID_REACHOUT_INPUT: () => toast.error('Pick at least one service and try again.'),
			RECIPIENT_NOT_FOUND: (error) => toast.error(error.message),
			CONVERSATION_PAIR_INVALID: (error) => toast.error(error.message),
			PROVIDER_NOT_APPROVED: (error) => toast.error(error.message),
			// Safety verification gates both roles, so this can fire for a family
			// as well as a helper — send them to the screen that fixes it.
			SAFETY_VERIFICATION_REQUIRED: (error) => toast.error(error.message),
			SAFETY_VERIFICATION_UNAVAILABLE: (error) => toast.error(error.message),
			UNAUTHORIZED: () => toast.error('Please sign in again.'),
			FORBIDDEN: () => toast.error("You can't send reach-outs right now."),
			// Codes below belong to sibling /conversations endpoints (they share
			// one error union) or are transport-level — all generic here.
			CONVERSATION_LOOKUP_FAILED: genericError,
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
		aria-label="Reach out to {recipient.name}"
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
					Reach out to {recipient.name}
				</h2>
				<button
					type="button"
					class="btn ml-auto btn-circle btn-ghost btn-sm"
					aria-label="Close"
					onclick={onclose}
				>
					<i class="las la-times text-lg" aria-hidden="true"></i>
				</button>
			</div>

			<div class="flex flex-col gap-4 px-6 py-4">
				<div>
					<div class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						Your message
					</div>
					<div
						class="flex items-start gap-2 rounded-lg border border-outline-variant/60 bg-base-200
							px-3.5 py-3 text-[13.5px] leading-relaxed text-base-content-muted"
					>
						<i class="las la-lock mt-0.5 shrink-0 text-outline" aria-hidden="true"></i>
						<span>{previewMessage}</span>
					</div>
					<p class="mt-1 text-[11px] text-outline">
						Standard reach-out message — the same for everyone, so no screening is needed.
					</p>
				</div>

				<div>
					<div class="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{senderRole === 'family' ? 'Services you need' : 'Services you can help with'}
						<span class="font-normal normal-case tracking-normal">
							(from {firstName}'s {senderRole === 'family' ? 'offering' : 'needs'})
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
						{firstName} will see your
						<strong>{senderRole === 'family' ? 'family profile' : 'profile'}</strong>
						and the services you selected. Your contact details stay hidden until you have an active contract.
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
					Send reach-out
				</button>
				<button type="button" class="btn btn-ghost" onclick={onclose}>Cancel</button>
				<span class="ml-auto text-[11px] text-outline">{firstName} can respond or ignore</span>
			</div>
		</div>
		<button type="button" class="modal-backdrop" onclick={onclose} aria-label="Close"></button>
	</div>
{/if}
