<script lang="ts">
	/** The reach-out inside a thread (design 16b/16c). While the conversation is
	 * pending it renders as the full card — with Respond / View profile / Ignore
	 * for the receiver, read-only for the sender. Once unlocked it collapses to
	 * summary pills; "View" re-expands the original card read-only. */
	import type { ResolvedPathname } from '$app/types';
	import type { ConversationSummary } from '$lib/api/conversations';

	interface Props {
		conversation: ConversationSummary;
		profileHref: ResolvedPathname;
		onrespond: () => void;
		onignore: () => void;
		responding?: boolean;
	}

	let { conversation, profileHref, onrespond, onignore, responding = false }: Props = $props();

	let expanded = $state(false);

	const firstName = $derived(conversation.counterpart.name.split(/\s+/)[0] ?? 'them');
	// The services chip label reflects who initiated: a family's reach-out lists
	// needs, a provider's lists what they offer.
	const initiatorIsFamily = $derived(
		conversation.reachout.sentByMe === (conversation.counterpart.role === 'service-provider')
	);
	const servicesLabel = $derived(initiatorIsFamily ? 'Needs' : 'Offers');
	const serviceNames = $derived(conversation.reachout.services.map((service) => service.name));
</script>

{#snippet fullCard(showActions: boolean)}
	<!-- Like a chat bubble: the sender's own reach-out sits right, a received one left. -->
	<div
		class={[
			'w-full max-w-[460px] overflow-hidden rounded-xl border border-base-600 bg-base-100 shadow-card',
			conversation.reachout.sentByMe ? 'self-end' : 'self-start'
		]}
	>
		<div class="flex items-center gap-2 border-b border-base-300 px-4 py-3">
			<i class="las la-comment text-base text-secondary" aria-hidden="true"></i>
			<span class="font-display text-[13px] font-bold text-base-content">
				{conversation.reachout.sentByMe ? 'Your reach-out' : `Reach-out from ${firstName}`}
			</span>
			<span
				class="ml-auto rounded-pill bg-warning-content px-2.5 py-0.5 text-[10.5px] font-semibold
					text-warning"
			>
				{conversation.reachout.sentByMe ? `Awaiting ${firstName}` : 'Awaiting you'}
			</span>
		</div>
		<p class="px-4 py-3 text-[13.5px] leading-relaxed text-base-content">
			{conversation.reachout.message}
		</p>
		<div class="flex flex-wrap items-center gap-1.5 px-4 pb-3">
			<span class="mr-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-outline uppercase">
				{servicesLabel}
			</span>
			<!-- Keyed by id: names are user-authored and may repeat. -->
			{#each conversation.reachout.services as service (service.serviceId)}
				<span class="rounded-pill bg-info-content px-2.5 py-0.5 text-[11.5px] font-semibold text-info">
					{service.name}
				</span>
			{/each}
		</div>
		{#if showActions}
			<div class="flex flex-col gap-2 border-t border-base-300 px-4 py-3 sm:flex-row sm:items-center">
				<button
					type="button"
					class="btn btn-primary btn-sm"
					disabled={responding}
					onclick={onrespond}
				>
					{#if responding}
						<span class="loading loading-sm loading-spinner"></span>
					{/if}
					Respond
				</button>
				<a href={profileHref} class="btn btn-outline btn-secondary btn-sm">
					View {initiatorIsFamily ? 'family' : ''} profile
				</a>
				<button
					type="button"
					class="btn btn-ghost btn-sm text-outline sm:ml-auto"
					disabled={responding}
					onclick={onignore}
				>
					Ignore
				</button>
			</div>
		{/if}
	</div>
{/snippet}

{#if conversation.status === 'pending'}
	{@render fullCard(conversation.awaitingMyResponse)}
	{#if conversation.awaitingMyResponse}
		<p class="ml-1 self-start text-[11px] text-outline">
			Ignoring quietly archives this — {firstName} isn't notified.
		</p>
	{/if}
{:else}
	<!-- Unlocked: reach-out collapses to a summary pill + unlock event pill. -->
	<button
		type="button"
		class="inline-flex items-center gap-2 self-center rounded-pill bg-base-300 px-3.5 py-1.5
			text-[11.5px] text-base-content-muted"
		onclick={() => (expanded = !expanded)}
	>
		<i class="las la-comment" aria-hidden="true"></i>
		<span>
			Reach-out from {conversation.reachout.sentByMe ? 'you' : firstName}
			· {serviceNames.join(', ')}
		</span>
		<span class="font-semibold text-secondary">{expanded ? 'Hide' : 'View'}</span>
	</button>
	{#if expanded}
		<div class="flex w-full justify-center">
			{@render fullCard(false)}
		</div>
	{/if}
	{#if conversation.respondedAt}
		<span
			class="inline-flex items-center gap-2 self-center rounded-pill border border-success/25
				bg-success-content px-3.5 py-1.5 text-[11.5px] text-success"
		>
			<i class="las la-check" aria-hidden="true"></i>
			{conversation.reachout.sentByMe ? firstName : 'You'} responded · conversation unlocked
		</span>
	{/if}
{/if}
