<script lang="ts">
	/** Shared contract detail for both roles (design 16d/16f/16h/16i/16j).
	 * Rendering is driven by the server-computed action flags — the receiver of
	 * a pending proposal decides (Accept & sign / Request changes / Decline),
	 * the family sender edits/withdraws, the active contract offers amendments
	 * and 2-weeks-notice ending. Viewing marks the contract seen, which clears
	 * the sidebar badge. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		acceptContract,
		amendContract,
		declineContract,
		endContract,
		getContract,
		markContractSeen,
		requestContractChanges,
		saveContractTerms,
		sendContract,
		withdrawContract,
		type ContractDetail,
		type ContractTermsInput
	} from '$lib/api/contracts';
	import { getProvider } from '$lib/api/providers';
	import { listServicesOffered } from '$lib/api/services-offered';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import ContractTermsEditor, {
		type EditorService
	} from '$lib/components/contracts/ContractTermsEditor.svelte';
	import ContractTermsView from '$lib/components/contracts/ContractTermsView.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import { formatDate, formatDateTime, formatDateWithWeekday } from '$lib/date';
	import { notifications } from '$lib/notifications.svelte';
	import { toast } from '$lib/toast.svelte';
	import { withQuery } from '$lib/nav';
	import { onMount } from 'svelte';

	interface Props {
		role: 'family' | 'service-provider';
	}

	let { role }: Props = $props();

	let contract = $state<ContractDetail | null>(null);
	let loading = $state(true);
	let loadError = $state(false);
	let retryTick = $state(0);

	let editorServices = $state<EditorService[]>([]);
	let editorServicesError = $state(false);

	let busy = $state(false);
	let amendmentOpen = $state(false);
	let acceptConfirmOpen = $state(false);
	let withdrawConfirmOpen = $state(false);
	let requestChangesConfirmOpen = $state(false);
	let declineOpen = $state(false);
	let declineReason = $state('');
	let endOpen = $state(false);
	let endNote = $state('');

	const contractId = $derived(page.params.id ?? '');
	const listHref = $derived(
		role === 'family' ? resolve('/family/contracts') : resolve('/service-provider/contracts')
	);
	const messagesHref = $derived(
		role === 'family' ? resolve('/family/messages') : resolve('/service-provider/messages')
	);
	const chatHref = $derived(
		contract ? withQuery(messagesHref, `c=${encodeURIComponent(contract.conversationId)}`) : null
	);

	const firstName = $derived(contract?.counterpart.name.split(/\s+/)[0] ?? '');

	// Monotonic fetch counter: only the newest in-flight response may land —
	// action- and realtime-triggered refreshes overlap freely.
	let refreshSeq = 0;
	async function refresh(id: string, options: { markSeen?: boolean } = {}) {
		refreshSeq += 1;
		const seq = refreshSeq;
		const result = await getContract(id);
		if (contractId !== id || seq !== refreshSeq) return;
		loading = false;
		if (!result.ok) {
			if (contract?.id !== id) loadError = true;
			return;
		}
		loadError = false;
		contract = result.data.contract;
		if (options.markSeen !== false) {
			void markContractSeen(id).then(() => void contractsBadge.refresh());
		}
	}

	// Plain variable, not $state: the effect must depend on the URL param (and
	// retryTick) only — reading `contract` here would refetch in a loop.
	let loadedContractId: string | null = null;
	let loadedRetryTick = -1;
	$effect(() => {
		const id = contractId;
		const tick = retryTick;
		if (!id) return;
		if (loadedContractId === id && loadedRetryTick === tick) return;
		const idChanged = loadedContractId !== id;
		loadedContractId = id;
		loadedRetryTick = tick;
		if (idChanged) {
			// Never render contract A (or act on its buttons) under B's URL.
			contract = null;
			amendmentOpen = false;
			acceptConfirmOpen = false;
			withdrawConfirmOpen = false;
			requestChangesConfirmOpen = false;
			declineOpen = false;
			endOpen = false;
			editorServices = [];
			editorServicesError = false;
			loadedServicesFor = null;
		}
		loading = true;
		loadError = false;
		void refresh(id);
	});

	onMount(() => {
		const contractEvents = [
			'contract.proposed',
			'contract.accepted',
			'contract.declined',
			'contract.changes_requested',
			'contract.ended'
		] as const;
		const unsubscribers = contractEvents.map((type) =>
			notifications.on(type, (event) => {
				if (event.payload.contractId === contractId) void refresh(contractId);
			})
		);
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	});

	// The editor's selectable set: the provider's current listing. Families read
	// the counterpart's public profile; a provider amending reads their own.
	const editorNeeded = $derived(
		contract !== null && (contract.actions.canEditTerms || amendmentOpen)
	);
	let loadedServicesFor: string | null = null;
	$effect(() => {
		if (!editorNeeded || contract === null) return;
		const key = `${role}:${contract.counterpart.userId}`;
		if (loadedServicesFor === key) return;
		loadedServicesFor = key;
		editorServicesError = false;
		// A back/forward id switch may race these responses — only the fetch
		// still owning the key may land. A failure clears the key so the next
		// render (or Retry) refetches instead of demanding a full reload.
		const applyServices = (
			services: Array<{ id: string; name: string; hourlyRateCents: number }>
		) => {
			if (loadedServicesFor !== key) return;
			editorServices = services.map((service) => ({
				id: service.id,
				name: service.name,
				hourlyRateCents: service.hourlyRateCents
			}));
		};
		const applyFailure = () => {
			if (loadedServicesFor !== key) return;
			loadedServicesFor = null;
			editorServicesError = true;
		};
		if (role === 'family') {
			void getProvider(contract.counterpart.userId).then((result) =>
				result.ok ? applyServices(result.data.services) : applyFailure()
			);
		} else {
			void listServicesOffered().then((result) =>
				result.ok ? applyServices(result.data.services) : applyFailure()
			);
		}
	});

	const termsErrorToast = (error: { code: string; message: string }) => {
		if (error.code === 'RATE_BELOW_LISTED') {
			toast.error(
				`Some rates are below ${firstName}'s current listed rate — raise them and retry.`
			);
		} else if (error.code === 'UNKNOWN_CONTRACT_SERVICE') {
			toast.error(`Pick services from ${firstName}'s current list.`);
		} else if (error.code === 'EMPTY_CONTRACT_TERMS') {
			toast.error('Add at least one service before sending.');
		} else if (error.code === 'INVALID_CONTRACT_TERMS') {
			toast.error('Check the rates and hours — something is out of range.');
		} else if (error.code === 'CONTRACT_STATE_INVALID') {
			toast.error('This contract has moved on — reloading.');
			void refresh(contractId);
		} else {
			toast.error("That didn't go through. Please try again.");
		}
	};

	/** Decision/notice actions: a conflict means the contract moved on under
	 * the viewer — "try again" would loop, so refetch and let the fresh action
	 * flags redraw the page instead. */
	const actionErrorToast = (error: { code: string }, fallback: string) => {
		if (
			error.code === 'CONTRACT_STATE_INVALID' ||
			error.code === 'CONTRACT_NOT_FOUND' ||
			error.code === 'CONTRACT_PROPOSAL_EXPIRED'
		) {
			toast.error('This contract has moved on — reloading.');
			void refresh(contractId);
		} else {
			toast.error(fallback);
		}
	};

	async function handleSaveDraft(terms: ContractTermsInput) {
		if (busy) return;
		busy = true;
		const result = await saveContractTerms(contractId, terms);
		busy = false;
		if (result.ok) {
			toast.success('Draft saved — only you can see it.');
			void refresh(contractId);
		} else {
			termsErrorToast(result.error);
		}
	}

	async function handleSendTerms(terms: ContractTermsInput) {
		if (busy) return;
		busy = true;
		const saved = await saveContractTerms(contractId, terms);
		if (!saved.ok) {
			busy = false;
			termsErrorToast(saved.error);
			return;
		}
		const sent = await sendContract(contractId);
		busy = false;
		if (sent.ok) {
			toast.success(`${firstName} was notified in Messages and Contracts.`, {
				title: 'Proposal sent'
			});
			void refresh(contractId);
		} else {
			termsErrorToast(sent.error);
		}
	}

	async function handleAmend(terms: ContractTermsInput) {
		if (busy) return;
		busy = true;
		const result = await amendContract(contractId, terms);
		busy = false;
		if (result.ok) {
			amendmentOpen = false;
			toast.success(`${firstName} was asked to review the new terms.`, { title: 'Amendment sent' });
			void refresh(contractId);
		} else {
			termsErrorToast(result.error);
		}
	}

	async function handleWithdraw() {
		if (busy) return;
		withdrawConfirmOpen = false;
		busy = true;
		const result = await withdrawContract(contractId);
		busy = false;
		if (result.ok) {
			toast.info(
				isAmendmentContext
					? 'Amendment withdrawn — the current terms stay in effect.'
					: 'Proposal withdrawn — it returned to a draft only you can see.'
			);
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, 'Withdrawing failed. Please try again.');
		}
	}

	/** "Edit proposal" = withdraw (silent), which reopens the draft editor. */
	async function handleEditProposal() {
		if (busy) return;
		busy = true;
		const result = await withdrawContract(contractId);
		busy = false;
		if (result.ok) {
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, 'Editing failed. Please try again.');
		}
	}

	async function handleAccept() {
		if (busy) return;
		acceptConfirmOpen = false;
		busy = true;
		const result = await acceptContract(contractId);
		busy = false;
		if (result.ok) {
			toast.success(
				isAmendmentContext ? 'The new terms are now in effect.' : 'Contact details are now shared.',
				{ title: isAmendmentContext ? 'Amendment accepted' : 'Contract active' }
			);
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, 'Accepting failed. Please try again.');
		}
	}

	async function handleDecline() {
		if (busy) return;
		busy = true;
		const result = await declineContract(contractId, declineReason.trim() || undefined);
		busy = false;
		if (result.ok) {
			declineOpen = false;
			declineReason = '';
			toast.info(`${firstName} was notified. The chat stays open.`, { title: 'Proposal declined' });
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, 'Declining failed. Please try again.');
		}
	}

	async function handleRequestChanges() {
		if (busy) return;
		requestChangesConfirmOpen = false;
		busy = true;
		const result = await requestContractChanges(contractId);
		busy = false;
		if (result.ok) {
			toast.info(`${firstName} was asked to revise the proposal.`);
			void goto(withQuery(messagesHref, `c=${encodeURIComponent(result.data.conversationId)}`));
		} else {
			actionErrorToast(result.error, 'Requesting changes failed. Please try again.');
		}
	}

	async function handleEnd() {
		if (busy) return;
		busy = true;
		const result = await endContract(contractId, endNote.trim() || undefined);
		busy = false;
		if (result.ok) {
			endOpen = false;
			endNote = '';
			toast.info(`Last working day: ${formatDateWithWeekday(result.data.endsOn)}.`, {
				title: 'Notice given'
			});
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, 'Ending failed. Please try again.');
		}
	}

	// Recomputed each time the dialog opens (reading endOpen), matching the
	// server's UTC-based endsOn — a stale value from a long-lived tab must not
	// disagree with the date the server will store.
	const noticeEndsOn = $derived(
		endOpen
			? formatDateWithWeekday(
					new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
				)
			: ''
	);

	const isAmendmentContext = $derived(
		contract !== null &&
			(contract.status === 'active' ||
				contract.status === 'ending' ||
				contract.status === 'ended') &&
			contract.pendingVersion !== null
	);

	/** The latest version that was actually declined — `latestVersion` may
	 * already be the family's fresh revision draft, which never carries the
	 * decline reason. */
	const latestDeclined = $derived(
		[...(contract?.versions ?? [])].reverse().find((version) => version.status === 'declined') ??
			null
	);

	const chip = $derived.by((): { status: ChipStatus; label?: string } => {
		if (!contract) return { status: 'empty' };
		if (
			contract.pendingVersion &&
			!contract.pendingVersion.proposedByMe &&
			contract.actions.canDecline
		) {
			return { status: 'awaiting-you' };
		}
		if (isAmendmentContext) return { status: 'proposed', label: 'Amendment pending' };
		if (contract.status === 'changes_requested') return { status: 'changes-requested' };
		return { status: contract.status as ChipStatus };
	});

	const subtitle = $derived.by(() => {
		if (!contract) return '';
		const pending = contract.pendingVersion;
		const accepted = contract.acceptedVersion;
		const latest = contract.latestVersion;
		switch (contract.status) {
			case 'draft':
				return `Draft v${latest?.version ?? 1} · started from your conversation`;
			case 'proposed':
			case 'expired':
				return pending
					? `Proposed ${pending.proposedByMe ? 'by you' : `by ${firstName}`} · v${pending.version}` +
							(pending.sentAt ? ` · sent ${formatDateTime(pending.sentAt)}` : '')
					: '';
			case 'changes_requested':
				return `v${latest?.version ?? 1} · changes requested`;
			case 'declined':
				return latestDeclined
					? `v${latestDeclined.version} · declined ${latestDeclined.proposedByMe ? `by ${firstName}` : 'by you'}` +
							(latestDeclined.decidedAt ? ` · ${formatDate(latestDeclined.decidedAt)}` : '')
					: '';
			case 'active':
				return accepted
					? `v${accepted.version} · signed by both` +
							(accepted.decidedAt ? ` · active since ${formatDate(accepted.decidedAt)}` : '')
					: '';
			case 'ending':
				return contract.endsOn ? `Ending · last day ${formatDate(contract.endsOn)}` : 'Ending';
			case 'ended':
				return contract.endsOn ? `Ended ${formatDate(contract.endsOn)}` : 'Ended';
			default:
				return '';
		}
	});

	/** The read-only terms shown when the editor isn't (receiver views, active
	 * contracts, the dimmed declined terms). */
	const displayTerms = $derived.by(() => {
		if (!contract) return null;
		if (isAmendmentContext) return contract.acceptedVersion;
		return contract.acceptedVersion ?? contract.pendingVersion ?? contract.latestVersion;
	});

	const showEditor = $derived(contract !== null && contract.actions.canEditTerms);
	const versionsNewestFirst = $derived([...(contract?.versions ?? [])].reverse());

	const historyLine = (version: NonNullable<typeof contract>['versions'][number]) => {
		const who = version.proposedByMe ? 'you' : firstName;
		const statusLabel: Record<string, string> = {
			draft: `drafted by ${who}`,
			proposed: `proposed by ${who}`,
			accepted: `proposed by ${who} · accepted`,
			superseded: `superseded`,
			declined: `proposed by ${who} · declined`,
			changes_requested: `proposed by ${who} · changes requested`,
			withdrawn: `proposed by ${who} · withdrawn`
		};
		const at = version.decidedAt ?? version.sentAt;
		return `v${version.version} ${statusLabel[version.status] ?? version.status}${at ? ` · ${formatDate(at)}` : ''}`;
	};
</script>

<svelte:head>
	<title>
		{contract ? `Contract with ${contract.counterpart.name} · Poppynz` : 'Contract · Poppynz'}
	</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-4">
	<a
		href={listHref}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		Contracts
	</a>

	{#if loading && !contract}
		<div class="flex justify-center py-24">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if loadError && !contract}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<p class="text-sm font-medium text-error" role="alert">This contract didn't load.</p>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => (retryTick = retryTick + 1)}
			>
				<i class="las la-redo-alt" aria-hidden="true"></i>
				Retry
			</button>
		</div>
	{:else if contract}
		<header class="flex items-center gap-3.5">
			<span
				class="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral text-lg
					font-bold text-base-100"
			>
				{contract.counterpart.name.charAt(0).toUpperCase()}
			</span>
			<div class="min-w-0 flex-1">
				<h1 class="truncate font-display text-xl font-bold text-base-content lg:text-2xl">
					Contract with {contract.counterpart.name}
				</h1>
				<p class="truncate text-xs text-base-content-muted">{subtitle}</p>
			</div>
			<StatusChip status={chip.status} label={chip.label} />
		</header>

		<!-- Status banners -->
		{#if contract.status === 'proposed' && contract.pendingVersion?.proposedByMe}
			<div class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3">
				<i class="las la-clock mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-neutral">
					Waiting for {firstName} — they were notified in Messages and Contracts.
					{#if contract.pendingVersion.expiresAt}
						Expires {formatDate(contract.pendingVersion.expiresAt)}.
					{/if}
				</p>
			</div>
		{:else if contract.status === 'expired'}
			<div class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3">
				<i class="las la-hourglass-end mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-neutral">
					This proposal expired without a decision.
					{#if contract.viewerSide === 'family'}
						Withdraw it below to revise and send new terms.
					{:else}
						{firstName} can send new terms from their side.
					{/if}
				</p>
			</div>
		{:else if contract.status === 'changes_requested'}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-content px-4 py-3"
			>
				<i class="las la-comment-dots mt-0.5 shrink-0 text-warning" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-warning">
					{#if contract.viewerSide === 'family'}
						{firstName} asked for changes — the details are in your chat. Revise the terms below and re-send.
					{:else}
						You asked {firstName} for changes in chat. The revised proposal will appear here.
					{/if}
				</p>
			</div>
		{:else if contract.status === 'declined'}
			{#if latestDeclined?.proposedByMe}
				<div
					class="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error-content px-4 py-3"
				>
					<i class="las la-times-circle mt-0.5 shrink-0 text-error" aria-hidden="true"></i>
					<p class="text-[12.5px] leading-relaxed text-error">
						{firstName} declined{latestDeclined?.declineReason
							? `: “${latestDeclined.declineReason}”`
							: ' the proposal.'}
						Your chat stays open — nothing else changes.
					</p>
				</div>
			{:else}
				<!-- 16j: the decliner gets a quiet neutral state, not an alarm. -->
				<div
					class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3"
				>
					<i class="las la-info-circle mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
					<p class="text-[12.5px] leading-relaxed text-neutral">
						You declined{latestDeclined?.declineReason
							? ` with the reason “${latestDeclined.declineReason}”`
							: ''}. {firstName} was notified and can propose new terms; the conversation stays open.
					</p>
				</div>
			{/if}
		{:else if contract.status === 'active' && !isAmendmentContext}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-content px-4 py-3"
			>
				<i class="las la-check-circle mt-0.5 shrink-0 text-success" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-success">
					{#if contract.viewerSide === 'family'}
						Contact details are now shared and weekly payments run on Poppynz. Either side can
						propose an amendment — it becomes the next version of this contract.
					{:else}
						Contact details are now shared and you get paid weekly on Poppynz. Either side can
						propose an amendment — it becomes the next version of this contract.
					{/if}
				</p>
			</div>
		{:else if contract.status === 'ending' || contract.status === 'ended'}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error-content px-4 py-3"
			>
				<i class="las la-clock mt-0.5 shrink-0 text-error" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-error">
					{contract.endedByMe ? 'You' : firstName} gave 2 weeks' notice
					{#if contract.endNoticedAt}
						on {formatDate(contract.endNoticedAt)}{/if}.
					{#if contract.endsOn}
						{contract.status === 'ended' ? 'The last working day was' : 'The last working day is'}
						<strong>{formatDateWithWeekday(contract.endsOn)}</strong> — payments run until then and stop
						after.
					{/if}
					{#if contract.endNote && !contract.endedByMe}
						Note: “{contract.endNote}”
					{/if}
				</p>
			</div>
		{/if}

		<div class="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
			<div class="flex min-w-0 flex-col gap-4">
				{#if amendmentOpen}
					<!-- The open editor outranks everything: a counterpart's amendment
				     arriving via realtime must not silently unmount typed input —
				     sending will 409 and the toast explains. -->
					<ContractTermsEditor
						providerServices={editorServices}
						initial={contract.acceptedVersion}
						mode="amendment"
						listingLabel={contract.viewerSide === 'family'
							? `${firstName}'s listing`
							: 'your listing'}
						counterpartFirstName={firstName}
						{busy}
						onsend={handleAmend}
						oncancel={() => (amendmentOpen = false)}
					/>
				{:else if isAmendmentContext && contract.pendingVersion}
					{#if displayTerms}
						<ContractTermsView terms={displayTerms} heading="Current terms" />
					{/if}
					<div class="rounded-xl border-[1.5px] border-primary/50 bg-base-100">
						<ContractTermsView
							terms={contract.pendingVersion}
							heading={`Proposed amendment — v${contract.pendingVersion.version}`}
						/>
						<div class="px-5 pb-4">
							{#if contract.actions.canAccept || contract.actions.canDecline}
								<div class="flex items-center gap-2.5">
									{#if contract.actions.canAccept}
										<button
											type="button"
											class="btn btn-primary btn-sm"
											disabled={busy}
											onclick={() => (acceptConfirmOpen = true)}
										>
											Accept new terms
										</button>
									{/if}
									{#if contract.actions.canDecline}
										<button
											type="button"
											class="btn btn-ghost btn-sm text-error"
											disabled={busy}
											onclick={() => (declineOpen = true)}
										>
											Decline
										</button>
									{/if}
								</div>
								<p class="mt-1.5 text-[11px] text-outline">
									Declining keeps the current terms in effect.
								</p>
							{:else}
								<p class="text-[12px] text-base-content-muted">
									Waiting for {firstName} to review the new terms — the current ones stay in effect meanwhile.
								</p>
								{#if contract.actions.canWithdraw}
									<button
										type="button"
										class="btn mt-2 btn-ghost btn-sm text-error"
										disabled={busy}
										onclick={() => (withdrawConfirmOpen = true)}
									>
										Withdraw amendment
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{:else if showEditor}
					{#if editorServicesError}
						<p class="rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
							{firstName}'s services didn't load — the editor needs them to add line items. Reload
							to try again.
						</p>
					{/if}
					<ContractTermsEditor
						providerServices={editorServices}
						initial={contract.pendingVersion ?? contract.latestVersion}
						mode="draft"
						listingLabel={`${firstName}'s listing`}
						counterpartFirstName={firstName}
						{busy}
						onsave={handleSaveDraft}
						onsend={handleSendTerms}
					/>
				{:else if displayTerms}
					<ContractTermsView
						terms={displayTerms}
						dimmed={contract.status === 'declined' || contract.status === 'expired'}
						heading={contract.status === 'declined'
							? `Proposed terms — v${displayTerms.version}`
							: 'Services & rates'}
					/>
				{/if}

				{#if contract.actions.canEnd}
					<div
						class="flex items-center gap-4 rounded-xl border border-card-border bg-base-100 px-5
							py-4"
					>
						<div class="min-w-0 flex-1">
							<h3 class="font-display text-[13.5px] font-bold text-base-content">
								End this contract
							</h3>
							<p class="mt-0.5 text-[12px] leading-relaxed text-base-content-muted">
								Either side can end with 2 weeks' notice. Payments run through the notice period,
								then stop.
							</p>
						</div>
						<button
							type="button"
							class="btn btn-outline btn-sm shrink-0 btn-error"
							disabled={busy}
							onclick={() => (endOpen = true)}
						>
							End contract…
						</button>
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-4">
				{#if contract.actions.canAccept || contract.actions.canDecline || contract.actions.canRequestChanges}
					{#if !isAmendmentContext}
						<div class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4">
							{#if contract.actions.canAccept}
								<button
									type="button"
									class="btn w-full btn-primary"
									disabled={busy}
									onclick={() => (acceptConfirmOpen = true)}
								>
									Accept &amp; sign
								</button>
							{/if}
							{#if contract.actions.canRequestChanges}
								<button
									type="button"
									class="btn w-full btn-outline"
									disabled={busy}
									onclick={() => (requestChangesConfirmOpen = true)}
								>
									Request changes
								</button>
							{/if}
							{#if contract.actions.canDecline}
								<button
									type="button"
									class="btn w-full btn-ghost text-error"
									disabled={busy}
									onclick={() => (declineOpen = true)}
								>
									Decline
								</button>
							{/if}
							<p class="text-center text-[11px] leading-relaxed text-outline">
								Request changes opens the chat with {firstName}
								{#if contract.pendingVersion?.expiresAt}
									· expires {formatDate(contract.pendingVersion.expiresAt)}{/if}
							</p>
						</div>
					{/if}
				{/if}

				{#if contract.actions.canWithdraw}
					<div class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4">
						<button
							type="button"
							class="btn w-full btn-outline"
							disabled={busy}
							onclick={handleEditProposal}
						>
							Edit proposal
						</button>
						<button
							type="button"
							class="btn w-full btn-ghost text-error"
							disabled={busy}
							onclick={() => (withdrawConfirmOpen = true)}
						>
							Withdraw
						</button>
						<p class="text-center text-[11px] leading-relaxed text-outline">
							Editing withdraws the proposal back to a private draft.
						</p>
					</div>
				{/if}

				{#if contract.counterpartContact}
					<div class="rounded-xl border border-card-border bg-base-100 p-4">
						<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
							{firstName}'s contact details
						</h3>
						<p class="flex items-center gap-2 text-[13px] text-base-content">
							<i class="las la-envelope text-outline" aria-hidden="true"></i>
							<a
								class="truncate hover:underline"
								href={`mailto:${contract.counterpartContact.email}`}
							>
								{contract.counterpartContact.email}
							</a>
						</p>
						{#if contract.counterpartContact.phone}
							<p class="mt-1.5 flex items-center gap-2 text-[13px] text-base-content">
								<i class="las la-phone text-outline" aria-hidden="true"></i>
								{contract.counterpartContact.phone}
							</p>
						{/if}
					</div>
				{:else}
					<div
						class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3"
					>
						<i class="las la-user-shield mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
						<p class="text-[12px] leading-relaxed text-neutral">
							Signing activates the contract — contact details are shared and payments are set up on
							Poppynz.
						</p>
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					{#if contract.actions.canAmend && !amendmentOpen}
						<button
							type="button"
							class="btn w-full btn-outline btn-sm"
							onclick={() => (amendmentOpen = true)}
						>
							Propose amendment
						</button>
					{/if}
					{#if chatHref}
						<a href={chatHref} class="btn w-full btn-outline btn-sm">Open chat with {firstName}</a>
					{/if}
				</div>

				<div class="rounded-xl border border-card-border bg-base-100 p-4">
					<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						History
					</h3>
					<ul class="flex flex-col gap-1 text-[12px] leading-relaxed text-base-content-muted">
						{#each versionsNewestFirst as version (version.version)}
							<li>{historyLine(version)}</li>
						{/each}
						{#if contract.conversationStartedAt}
							<li>Conversation started · {formatDate(contract.conversationStartedAt)}</li>
						{/if}
					</ul>
				</div>
			</div>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={acceptConfirmOpen}
	title={isAmendmentContext ? 'Accept the new terms?' : 'Accept & sign this contract?'}
	body={isAmendmentContext
		? 'The new terms replace the current ones as the next version of this contract.'
		: 'Signing activates the contract — contact details are shared and weekly payments are set up on Poppynz.'}
	confirmLabel={isAmendmentContext ? 'Accept new terms' : 'Accept & sign'}
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleAccept}
	oncancel={() => (acceptConfirmOpen = false)}
/>

<ConfirmDialog
	open={withdrawConfirmOpen}
	title={isAmendmentContext ? 'Withdraw this amendment?' : 'Withdraw this proposal?'}
	body={isAmendmentContext
		? `The current terms stay in effect — ${firstName} isn't notified.`
		: `It returns to a draft only you can see — ${firstName} isn't notified.`}
	confirmLabel="Withdraw"
	{busy}
	onconfirm={handleWithdraw}
	oncancel={() => (withdrawConfirmOpen = false)}
/>

<ConfirmDialog
	open={requestChangesConfirmOpen}
	title="Request changes?"
	body="This doesn't open an editor — it takes you back to the chat with {firstName}, and they revise the proposal from their side."
	confirmLabel="Request changes"
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleRequestChanges}
	oncancel={() => (requestChangesConfirmOpen = false)}
/>

{#if declineOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Decline proposal">
		<div class="modal-box max-w-md border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{isAmendmentContext ? 'Decline the new terms?' : 'Decline this proposal?'}
			</h3>
			<p class="py-3 text-sm text-base-content-muted">
				{isAmendmentContext
					? `The current terms stay in effect. ${firstName} is notified.`
					: `${firstName} is notified, and your chat stays open — declining a contract never closes the conversation.`}
			</p>
			<label
				class="mb-1 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
				for="decline-reason"
			>
				Reason (optional, shared)
			</label>
			<textarea
				id="decline-reason"
				class="textarea w-full text-[13px]"
				rows={2}
				maxlength={1000}
				placeholder="e.g. Schedule no longer works."
				bind:value={declineReason}
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={() => (declineOpen = false)}
				>
					Cancel
				</button>
				<button type="button" class="btn btn-error" disabled={busy} onclick={handleDecline}>
					{#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
					Decline
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (declineOpen = false)}
			aria-label="Close"
		></button>
	</div>
{/if}

{#if endOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="End contract">
		<div class="modal-box max-w-md border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">End this contract?</h3>
			<p class="py-3 text-sm text-base-content-muted">
				Your 2 weeks' notice starts today. The last working day is
				<strong class="text-base-content">{noticeEndsOn}</strong> — {firstName} is notified now, payments
				run until then and stop after. This can't be undone.
			</p>
			<textarea
				class="textarea w-full text-[13px]"
				rows={2}
				maxlength={1000}
				placeholder="Add a note for {firstName} (optional)…"
				bind:value={endNote}
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={() => (endOpen = false)}
				>
					Keep contract
				</button>
				<button type="button" class="btn btn-error" disabled={busy} onclick={handleEnd}>
					{#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
					Give notice &amp; end
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (endOpen = false)}
			aria-label="Close"
		></button>
	</div>
{/if}
