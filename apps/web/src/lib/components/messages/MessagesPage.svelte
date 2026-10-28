<script lang="ts">
	import { formatPlace } from '$lib/location';
	import { contactDetailsWarning, standingChatNotice } from '$lib/off-platform-notice';
	/** Shared Messages screen for both roles (design 16b/16c). Desktop shows the
	 * conversation list and the thread side by side; on mobile the `?c=` query
	 * param switches between the list screen and the chat screen, so the back
	 * chevron (and browser back) pops chat → list. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		getConversation,
		ignoreReachout,
		listConversations,
		markConversationRead,
		respondToReachout,
		sendMessage,
		type ConversationDetailData,
		type ConversationMessage,
		type ConversationSummary
	} from '$lib/api/conversations';
	import { createContract } from '$lib/api/contracts';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import ReachoutCard from '$lib/components/messages/ReachoutCard.svelte';
	import {
		forgetReplacement,
		readReplacementParams,
		recallReplacement,
		startReplacementWithToast
	} from '$lib/replacement';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';
	import { unread } from '$lib/unread.svelte';
	import { withQuery } from '$lib/nav';
	import { formatTime, relativeDayLabel } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	let conversations = $state<ConversationSummary[]>([]);
	let listLoading = $state(true);
	let listError = $state(false);

	let thread = $state<ConversationDetailData | null>(null);
	let threadLoading = $state(false);
	let threadError = $state(false);
	let draft = $state('');
	let sending = $state(false);
	let responding = $state(false);
	let creatingContract = $state(false);
	let ignoreConfirmOpen = $state(false);
	let messagesEnd = $state<HTMLElement | null>(null);

	const selectedId = $derived(page.url.searchParams.get('c'));

	const listHref = $derived(
		role === 'family' ? resolve('/family/messages') : resolve('/service-provider/messages')
	);
	const findHref = $derived(
		role === 'family' ? resolve('/family/find') : resolve('/service-provider/find')
	);

	const profileHref = (userId: string) =>
		role === 'family'
			? resolve('/family/providers/[userId]', { userId })
			: resolve('/service-provider/families/[userId]', { userId });

	// Find a replacement (Tier 3 step 1b): the family reached out to this
	// helper to replace cancelled sessions (the context comes in the URL, or
	// was remembered when the reach-out was sent). Once the conversation is
	// unlocked, the thread offers the contract as a template.
	let replacementDismissedFor = $state<string | null>(null);
	let startingReplacement = $state(false);
	const threadReplacement = $derived.by(() => {
		if (role !== 'family' || !thread) return null;
		const counterpartId = thread.conversation.counterpart.userId;
		if (replacementDismissedFor === counterpartId) return null;
		if (thread.conversation.status !== 'active' && thread.conversation.status !== 'pending') {
			return null;
		}
		return readReplacementParams(page.url.searchParams) ?? recallReplacement(counterpartId);
	});

	async function handleUseTemplate() {
		const current = thread;
		if (!current || !threadReplacement || startingReplacement) return;
		startingReplacement = true;
		await startReplacementWithToast(threadReplacement, {
			userId: current.conversation.counterpart.userId,
			name: threadFirstName
		});
		startingReplacement = false;
	}

	function dismissReplacement() {
		if (!thread) return;
		forgetReplacement(thread.conversation.counterpart.userId);
		replacementDismissedFor = thread.conversation.counterpart.userId;
	}

	const contractHref = (contractId: string) =>
		role === 'family'
			? resolve('/family/contracts/[id]', { id: contractId })
			: resolve('/service-provider/contracts/[id]', { id: contractId });

	async function refreshList() {
		const result = await listConversations();
		listLoading = false;
		if (result.ok) {
			conversations = result.data.conversations;
			listError = false;
		} else if (conversations.length === 0) {
			listError = true;
		}
	}

	async function refreshThread(id: string, options: { markRead?: boolean } = {}) {
		const result = await getConversation(id);
		// The selection may have moved on while the request was in flight —
		// never let a stale response clobber the newly selected thread.
		if (selectedId !== id) return;
		threadLoading = false;
		if (!result.ok) {
			if (thread?.conversation.id !== id) threadError = true;
			return;
		}
		threadError = false;
		thread = result.data;
		if (options.markRead !== false) {
			void markConversationRead(id).then(() => {
				void unread.refresh();
				void refreshList();
			});
		}
	}

	onMount(() => {
		void refreshList();
		const unsubscribers = [
			notifications.on('conversation.message', (event) => {
				if (event.payload.conversationId === selectedId) {
					void refreshThread(event.payload.conversationId);
				} else {
					void refreshList();
				}
			}),
			notifications.on('conversation.reachout', () => void refreshList()),
			notifications.on('conversation.unlocked', (event) => {
				void refreshList();
				if (event.payload.conversationId === selectedId) {
					void refreshThread(event.payload.conversationId, { markRead: false });
				}
			}),
			// Contract events carry a contractId, not a conversationId — refresh
			// the open thread so its contract pill tracks the latest state.
			...(
				[
					'contract.proposed',
					'contract.accepted',
					'contract.declined',
					'contract.changes_requested',
					'contract.ended'
				] as const
			).map((type) =>
				notifications.on(type, () => {
					if (selectedId) void refreshThread(selectedId, { markRead: false });
				})
			)
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	});

	// Plain variable, not $state: the effect must depend on the URL param only.
	// Reading `thread` here would track it and re-run the effect on every fetch
	// result — an infinite request loop (same gotcha as the dashboard page).
	let loadedThreadId: string | null = null;
	$effect(() => {
		const id = selectedId;
		if (!id) {
			loadedThreadId = null;
			thread = null;
			return;
		}
		if (loadedThreadId === id) return;
		loadedThreadId = id;
		thread = null;
		threadLoading = true;
		threadError = false;
		draft = '';
		void refreshThread(id);
	});

	// Keep the newest message in view whenever the thread grows.
	$effect(() => {
		void thread?.messages.length;
		messagesEnd?.scrollIntoView({ block: 'end' });
	});

	function openConversation(id: string) {
		void goto(withQuery(listHref, `c=${encodeURIComponent(id)}`), { noScroll: true });
	}

	/** Messaging needs both people to hold a live approval (and the viewer a
	 * verified safety check). Those refusals explain themselves, so the toast
	 * names the reason (localized here); anything else gets the generic fallback. */
	function standingErrorMessage(error: { code: string }): string | null {
		switch (error.code) {
			case 'COUNTERPART_UNAVAILABLE':
				return m.messages_error_counterpart_unavailable();
			case 'FAMILY_NOT_APPROVED':
			case 'PROVIDER_NOT_APPROVED':
				return m.messages_error_approval_needed_message();
			case 'APPROVAL_UNAVAILABLE':
				return m.messages_error_approval_unavailable();
			case 'SAFETY_VERIFICATION_REQUIRED':
				return m.messages_error_safety_required();
			case 'SAFETY_VERIFICATION_UNAVAILABLE':
				return m.messages_error_safety_unavailable();
			default:
				return null;
		}
	}

	async function handleSend(event: SubmitEvent) {
		event.preventDefault();
		const id = selectedId;
		const body = draft.trim();
		if (!id || !body || sending) return;
		sending = true;
		const result = await sendMessage(id, body);
		sending = false;
		if (result.ok) {
			draft = '';
			if (result.data.contactWarning) {
				toast.info(contactDetailsWarning(), { title: m.messages_contact_shared_title() });
			}
			thread = thread && {
				...thread,
				messages: [...thread.messages, result.data]
			};
			void refreshList();
		} else {
			toast.error(
				standingErrorMessage(result.error) ??
					(result.error.code === 'CONVERSATION_LOCKED'
						? m.messages_error_locked()
						: m.messages_error_send_failed())
			);
		}
	}

	/** 16g: the family-side "Propose terms" in an unlocked thread — the only
	 * place a contract can be created. An existing contract just navigates. */
	async function handleProposeTerms() {
		const id = selectedId;
		if (!id || creatingContract) return;
		creatingContract = true;
		const result = await createContract(id);
		creatingContract = false;
		if (result.ok) {
			void goto(contractHref(result.data.id));
		} else if (result.error.code === 'CONTRACT_EXISTS') {
			void goto(contractHref(result.error.contractId));
		} else {
			toast.error(m.messages_error_contract_start_failed());
		}
	}

	const contractPill = $derived.by(() => {
		const contract = thread?.contract;
		if (!contract) return null;
		switch (contract.status) {
			case 'draft':
				return { label: m.messages_contract_draft(), tone: 'neutral' as const };
			case 'proposed':
				return contract.awaitingYou
					? { label: m.messages_contract_review_proposal(), tone: 'accent' as const }
					: { label: m.messages_contract_proposal_sent(), tone: 'neutral' as const };
			case 'expired':
				return { label: m.messages_contract_proposal_expired(), tone: 'neutral' as const };
			case 'changes_requested':
				return { label: m.messages_contract_changes_requested(), tone: 'warning' as const };
			case 'declined':
				return { label: m.messages_contract_proposal_declined(), tone: 'neutral' as const };
			case 'active':
				return { label: m.messages_contract_active(), tone: 'success' as const };
			case 'ending':
				return { label: m.messages_contract_ending(), tone: 'warning' as const };
			case 'ended':
				return { label: m.messages_contract_ended(), tone: 'neutral' as const };
			default:
				return null;
		}
	});

	const pillToneClass = {
		neutral: 'bg-base-300 text-neutral',
		accent: 'bg-accent/15 text-accent',
		warning: 'bg-warning-content text-warning',
		success: 'bg-success-content text-success'
	};

	async function handleRespond() {
		const id = selectedId;
		if (!id || responding) return;
		responding = true;
		const result = await respondToReachout(id);
		responding = false;
		if (result.ok) {
			await refreshThread(id);
			void refreshList();
		} else {
			toast.error(standingErrorMessage(result.error) ?? m.messages_error_respond_failed());
		}
	}

	async function handleIgnore() {
		const id = selectedId;
		if (!id) return;
		ignoreConfirmOpen = false;
		const result = await ignoreReachout(id);
		if (result.ok) {
			toast.info(m.messages_ignore_done());
			void unread.refresh();
			conversations = conversations.filter((conversation) => conversation.id !== id);
			void goto(listHref, { noScroll: true });
		} else {
			toast.error(m.messages_error_archive_failed());
		}
	}

	// "Today" / "Yesterday" / "Aug 4", localized.
	const dayLabel = (iso: string) => relativeDayLabel(iso);

	const timeLabel = (iso: string) => formatTime(iso);

	const listTimestamp = (conversation: ConversationSummary) =>
		dayLabel(conversation.lastMessage?.at ?? conversation.createdAt) === m.date_today()
			? timeLabel(conversation.lastMessage?.at ?? conversation.createdAt)
			: dayLabel(conversation.lastMessage?.at ?? conversation.createdAt);

	const listPreview = (conversation: ConversationSummary) => {
		if (conversation.lastMessage) return conversation.lastMessage.body;
		if (conversation.awaitingMyResponse) {
			return m.messages_preview_wants_to_work({
				name: conversation.counterpart.name.split(/\s+/)[0] ?? ''
			});
		}
		return conversation.reachout.sentByMe
			? m.messages_preview_reachout_sent()
			: conversation.reachout.message;
	};

	const isUnread = (conversation: ConversationSummary) =>
		conversation.unreadCount > 0 || conversation.awaitingMyResponse;

	const counterpartRoleLabel = $derived(
		thread?.conversation.counterpart.role === 'family'
			? m.messages_counterpart_family()
			: m.messages_counterpart_provider()
	);
	const threadFirstName = $derived(thread?.conversation.counterpart.name.split(/\s+/)[0] ?? '');
	const composerState = $derived.by((): 'active' | 'awaiting-me' | 'awaiting-them' => {
		if (!thread || thread.conversation.status === 'active') return 'active';
		return thread.conversation.awaitingMyResponse ? 'awaiting-me' : 'awaiting-them';
	});

	/** Messages grouped by calendar day, mirroring the design's day dividers. */
	const messageGroups = $derived.by(() => {
		const groups: Array<{ label: string; messages: ConversationMessage[] }> = [];
		for (const message of thread?.messages ?? []) {
			const label = dayLabel(message.at);
			const current = groups.at(-1);
			if (current && current.label === label) current.messages.push(message);
			else groups.push({ label, messages: [message] });
		}
		return groups;
	});
</script>

<svelte:head>
	<title>{m.messages_page_title()}</title>
</svelte:head>

<div
	class="flex h-[calc(100dvh-6.5rem)] min-h-[440px] overflow-hidden rounded-xl border
		border-card-border bg-base-100 lg:h-[calc(100dvh-8.5rem)]"
>
	<!-- Conversation list pane -->
	<section
		class={[
			'w-full flex-col border-card-border lg:flex lg:w-[330px] lg:shrink-0 lg:border-r',
			selectedId ? 'hidden' : 'flex'
		]}
		aria-label={m.messages_list_aria()}
	>
		<header class="px-5 pt-5 pb-3">
			<h1 class="font-display text-xl font-bold text-base-content">{m.messages_heading()}</h1>
		</header>
		{#if listLoading}
			<div class="flex flex-col gap-3 px-5">
				{#each [0, 1, 2] as index (index)}
					<div class="flex items-center gap-3">
						<div class="skeleton size-10 shrink-0 rounded-full"></div>
						<div class="flex-1 space-y-2">
							<div class="skeleton h-3.5 w-1/2"></div>
							<div class="skeleton h-3 w-4/5"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if listError}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
				<p class="text-sm text-base-content-muted">{m.messages_list_load_failed()}</p>
				<button type="button" class="btn btn-primary btn-sm" onclick={() => void refreshList()}>
					<i class="las la-redo-alt" aria-hidden="true"></i>
					{m.messages_retry()}
				</button>
			</div>
		{:else if conversations.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
				<span class="flex size-14 items-center justify-center rounded-full bg-base-400">
					<i class="las la-comments text-2xl text-neutral" aria-hidden="true"></i>
				</span>
				<h2 class="font-display text-base font-bold text-base-content">
					{m.messages_empty_title()}
				</h2>
				<p class="max-w-[240px] text-[13px] text-base-content-muted">
					{role === 'family' ? m.messages_empty_body_family() : m.messages_empty_body_provider()}
				</p>
				<a href={findHref} class="btn btn-primary btn-sm">
					{role === 'family' ? m.messages_find_help() : m.messages_find_families()}
				</a>
			</div>
		{:else}
			<ul class="flex-1 overflow-y-auto">
				{#each conversations as conversation (conversation.id)}
					{@const active = conversation.id === selectedId}
					<li>
						<button
							type="button"
							class={[
								'flex w-full gap-3 border-l-[3px] px-5 py-3.5 text-left transition-colors',
								active ? 'border-primary bg-base-300' : 'border-transparent hover:bg-base-200'
							]}
							onclick={() => openConversation(conversation.id)}
						>
							<div class="relative">
								<span
									class="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral
									text-sm font-bold text-base-100"
								>
									{conversation.counterpart.name.charAt(0).toUpperCase()}
								</span>
								{#if !conversation.awaitingMyResponse && conversation.unreadCount > 0}
									<span
										class="mt-1.5 inline-block rounded-pill bg-accent px-2 py-0.5 text-[10.5px]
											font-bold text-accent-content absolute -bottom-1 -right-1"
									>
										{conversation.unreadCount}
									</span>
								{/if}
							</div>
							<span class="min-w-0 flex-1">
								<span class="flex items-baseline gap-2">
									<span
										class={[
											'truncate text-[13.5px] text-base-content',
											isUnread(conversation) ? 'font-bold' : 'font-semibold'
										]}
									>
										{conversation.counterpart.name}
									</span>
									<span class="ml-auto shrink-0 text-[11px] text-outline">
										{listTimestamp(conversation)}
									</span>
								</span>
								<span
									class={[
										'mt-0.5 block truncate text-[12.5px]',
										isUnread(conversation)
											? 'font-semibold text-base-content'
											: 'text-base-content-muted'
									]}
								>
									{listPreview(conversation)}
								</span>
								{#if conversation.awaitingMyResponse}
									<span
										class="mt-1.5 inline-block rounded-pill bg-warning-content px-2.5 py-0.5
											text-[10.5px] font-semibold text-warning"
									>
										{m.messages_new_reachout_badge()}
									</span>
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Thread pane -->
	<section
		class={['min-w-0 flex-1 flex-col bg-base-200 lg:flex', selectedId ? 'flex' : 'hidden']}
		aria-label={m.messages_thread_aria()}
	>
		{#if !selectedId}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 text-center">
				<i class="las la-comment-dots text-4xl text-outline-variant" aria-hidden="true"></i>
				<p class="text-sm text-base-content-muted">{m.messages_select_conversation()}</p>
			</div>
		{:else if threadLoading && !thread}
			<div class="flex flex-1 items-center justify-center">
				<span class="loading loading-lg loading-spinner text-primary"></span>
			</div>
		{:else if threadError && !thread}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
				<p class="text-sm text-base-content-muted">{m.messages_thread_load_failed()}</p>
				<button
					type="button"
					class="btn btn-primary btn-sm"
					onclick={() => selectedId && void refreshThread(selectedId)}
				>
					<i class="las la-redo-alt" aria-hidden="true"></i>
					{m.messages_retry()}
				</button>
			</div>
		{:else if thread}
			<header
				class="flex items-center gap-3 border-b border-card-border bg-base-100 px-4 py-3 lg:px-6"
			>
				<a
					href={listHref}
					class="btn btn-circle btn-ghost btn-sm lg:hidden"
					aria-label={m.messages_back_to_list()}
				>
					<i class="las la-angle-left text-xl" aria-hidden="true"></i>
				</a>
				<span
					class="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral text-sm
						font-bold text-base-100"
				>
					{thread.conversation.counterpart.name.charAt(0).toUpperCase()}
				</span>
				<div class="min-w-0">
					<a
						class="block truncate font-display text-[15px] font-bold text-base-content hover:text-secondary"
						href={profileHref(thread.conversation.counterpart.userId)}
					>
						{thread.conversation.counterpart.name}
					</a>
					<p class="truncate text-[11.5px] text-outline">
						{#if thread.conversation.counterpart.city}
							{m.messages_counterpart_with_city({
								role: counterpartRoleLabel,
								city:
									formatPlace(
										thread.conversation.counterpart.city,
										thread.conversation.counterpart.stateProvince
									) ?? thread.conversation.counterpart.city
							})}
						{:else}
							{counterpartRoleLabel}
						{/if}
					</p>
				</div>
				{#if thread.contract && contractPill}
					<a
						href={contractHref(thread.contract.id)}
						class="ml-auto shrink-0 rounded-pill px-3 py-1.5 text-[11.5px] font-semibold
							transition-opacity hover:opacity-80 {pillToneClass[contractPill.tone]}"
					>
						{contractPill.label}
					</a>
				{:else if role === 'family' && thread.conversation.status === 'active'}
					<!-- 16g: contract creation lives here and nowhere else. -->
					<button
						type="button"
						class="btn ml-auto shrink-0 btn-primary btn-sm"
						disabled={creatingContract}
						onclick={handleProposeTerms}
					>
						{#if creatingContract}
							<span class="loading loading-xs loading-spinner"></span>
						{:else}
							<i class="las la-file-signature" aria-hidden="true"></i>
						{/if}
						{m.messages_propose_terms()}
					</button>
				{/if}
			</header>

			<div class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5 lg:px-6">
				<div class="flex items-center gap-3">
					<span class="h-px flex-1 bg-base-600"></span>
					<span class="text-[10.5px] font-semibold tracking-[0.08em] text-outline uppercase">
						{dayLabel(thread.conversation.createdAt)}
					</span>
					<span class="h-px flex-1 bg-base-600"></span>
				</div>

				<ReachoutCard
					conversation={thread.conversation}
					profileHref={profileHref(thread.conversation.counterpart.userId)}
					onrespond={handleRespond}
					onignore={() => (ignoreConfirmOpen = true)}
					{responding}
				/>

				{#if threadReplacement}
					<div
						class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-base-100 px-4 py-3"
						data-testid="thread-replacement"
					>
						<div class="flex items-start gap-2.5">
							<i class="las la-user-friends mt-0.5 shrink-0 text-lg text-accent" aria-hidden="true"
							></i>
							<div class="min-w-0 flex-1">
								<p class="text-[13px] font-bold text-base-content">
									{m.replacement_thread_title()}
								</p>
								<p class="mt-0.5 text-[12.5px] leading-relaxed text-base-content-muted">
									{thread.conversation.status === 'active'
										? m.replacement_thread_body({ name: threadFirstName })
										: m.replacement_thread_pending({ name: threadFirstName })}
								</p>
							</div>
							<button
								type="button"
								class="btn btn-circle btn-ghost btn-xs"
								aria-label={m.common_dismiss()}
								onclick={dismissReplacement}
							>
								<i class="las la-times" aria-hidden="true"></i>
							</button>
						</div>
						{#if thread.conversation.status === 'active'}
							<div class="pl-7">
								<button
									type="button"
									class="btn btn-sm btn-secondary"
									disabled={startingReplacement}
									onclick={() => void handleUseTemplate()}
									data-testid="thread-use-template"
								>
									{#if startingReplacement}
										<span class="loading loading-xs loading-spinner"></span>
									{:else}
										<i class="las la-copy" aria-hidden="true"></i>
									{/if}
									{m.replacement_use_template()}
								</button>
							</div>
						{/if}
					</div>
				{/if}

				{#if thread.contract && ['active', 'declined', 'ending', 'ended'].includes(thread.contract.status)}
					<!-- 16h/16j: contract state rendered from the thread summary — no
					     contract rows ever live in the message history. -->
					<div class="flex justify-center">
						<span
							class={[
								'inline-flex items-center gap-2 rounded-pill py-1.5 pr-1.5 pl-3.5 text-[11.5px]',
								thread.contract.status === 'active'
									? 'bg-success-content text-success'
									: 'bg-base-300 text-neutral'
							]}
						>
							{#if thread.contract.status === 'active'}
								{m.messages_contract_active()}
							{:else if thread.contract.status === 'declined'}
								{m.messages_contract_proposal_declined()}
							{:else if thread.contract.status === 'ending'}
								{m.messages_contract_ending()}
							{:else}
								{m.messages_contract_ended()}
							{/if}
							<a
								href={contractHref(thread.contract.id)}
								class={[
									'rounded-pill px-3 py-1 text-[11px] font-semibold',
									thread.contract.status === 'active'
										? 'bg-success text-success-content'
										: 'border-[1.5px] border-outline-variant bg-base-100 text-secondary'
								]}
							>
								{m.common_view()}
							</a>
						</span>
					</div>
				{/if}

				{#each messageGroups as group (group.label)}
					{#if dayLabel(thread.conversation.createdAt) !== group.label}
						<div class="flex items-center gap-3">
							<span class="h-px flex-1 bg-base-600"></span>
							<span class="text-[10.5px] font-semibold tracking-[0.08em] text-outline uppercase">
								{group.label}
							</span>
							<span class="h-px flex-1 bg-base-600"></span>
						</div>
					{/if}
					{#each group.messages as message (message.id)}
						<div
							class={['max-w-[76%] lg:max-w-[64%]', message.sentByMe ? 'self-end' : 'self-start']}
						>
							<div
								class={[
									'px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-line text-base-content',
									message.sentByMe
										? 'rounded-[14px] rounded-br-[4px] bg-base-500'
										: 'rounded-[14px] rounded-bl-[4px] border border-card-border bg-base-100'
								]}
							>
								{message.body}
							</div>
							{#if message.contactWarning}
								<!-- UAT #38: both people see this; the API recorded it. -->
								<p
									class="mt-1.5 flex items-start gap-1.5 rounded-md border border-warning-border
										bg-warning-content/40 px-2.5 py-1.5 text-[11px] leading-snug text-warning"
									role="note"
								>
									<i class="las la-exclamation-triangle mt-0.5 shrink-0" aria-hidden="true"></i>
									{contactDetailsWarning()}
								</p>
							{/if}
							<div
								class={[
									'mt-1 text-[10.5px] text-outline',
									message.sentByMe ? 'text-right' : 'ml-1'
								]}
							>
								{timeLabel(message.at)}
							</div>
						</div>
					{/each}
				{/each}
				<div bind:this={messagesEnd}></div>
			</div>

			<div class="px-4 pt-2 pb-4 lg:px-6">
				<p class="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-outline">
					<i class="las la-shield-alt mt-0.5 shrink-0" aria-hidden="true"></i>
					{standingChatNotice()}
				</p>
				{#if composerState === 'active'}
					<form
						class="flex items-center gap-2 rounded-pill border-[1.5px] border-outline-variant
							bg-base-100 py-1.5 pr-1.5 pl-5"
						onsubmit={handleSend}
					>
						<input
							type="text"
							class="min-w-0 flex-1 bg-transparent text-[13.5px] text-base-content outline-none
								placeholder:text-outline"
							placeholder={m.messages_composer_placeholder({ name: threadFirstName })}
							maxlength={4000}
							bind:value={draft}
						/>
						<button
							type="submit"
							class="btn btn-circle btn-primary btn-sm"
							disabled={sending || draft.trim().length === 0}
							aria-label={m.messages_send_aria()}
						>
							{#if sending}
								<span class="loading loading-xs loading-spinner"></span>
							{:else}
								<i class="las la-arrow-right text-base" aria-hidden="true"></i>
							{/if}
						</button>
					</form>
				{:else}
					<div
						class="flex items-center gap-2 rounded-pill border-[1.5px] border-outline-variant/60
							bg-base-300 py-1.5 pr-1.5 pl-5 opacity-70"
					>
						<span class="flex-1 text-[13px] text-outline">
							{composerState === 'awaiting-me'
								? m.messages_composer_respond_to_unlock()
								: m.messages_composer_awaiting_them({ name: threadFirstName })}
						</span>
						<span
							class="flex size-8 items-center justify-center rounded-full bg-outline-variant
								text-base-100"
						>
							<i class="las la-arrow-right text-base" aria-hidden="true"></i>
						</span>
					</div>
				{/if}
			</div>
		{/if}
	</section>
</div>

<ConfirmDialog
	open={ignoreConfirmOpen}
	title={m.messages_ignore_title()}
	body={m.messages_ignore_body({ name: threadFirstName })}
	confirmLabel={m.messages_ignore_confirm()}
	onconfirm={handleIgnore}
	oncancel={() => (ignoreConfirmOpen = false)}
/>
