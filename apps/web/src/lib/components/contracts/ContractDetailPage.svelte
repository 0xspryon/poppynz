<script lang="ts">
	/** Shared contract detail for both roles (Flow F). Rendering is driven by
	 * the server-computed action flags — the receiver of a pending proposal
	 * decides (Accept & sign / Request changes / Decline), the family sender
	 * edits/withdraws, the active contract offers 2-weeks-notice ending. Signed
	 * contracts are never amended — they run out or are ended, and a new
	 * contract is created. Viewing marks the contract seen, which clears the
	 * sidebar badge. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		acceptContract,
		declineContract,
		endContract,
		getContract,
		markContractSeen,
		requestContractChanges,
		saveContractTerms,
		sendContract,
		quoteContractTerms,
		withdrawContract,
		type ContractDetail,
		type ContractTermsInput
	} from '$lib/api/contracts';
	import { getProvider } from '$lib/api/providers';
	import { todayIn } from '@repo/calendar';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import PayoutsReminder from '$lib/components/payouts/PayoutsReminder.svelte';
	import StatusChip, { type ChipStatus } from '$lib/components/StatusChip.svelte';
	import ContractTermsEditor, {
		type EditorService
	} from '$lib/components/contracts/ContractTermsEditor.svelte';
	import ContractTermsView from '$lib/components/contracts/ContractTermsView.svelte';
	import ContractBillingPanel from '$lib/components/contracts/ContractBillingPanel.svelte';
	import WeekAtAGlance from '$lib/components/contracts/WeekAtAGlance.svelte';
	import { contractsBadge } from '$lib/contracts-badge.svelte';
	import {
		formatEndTime,
		minutesToHours,
		noticeLastDay,
		weeklyMinutes
	} from '$lib/contract-sessions';
	import { formatMoney } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
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
	let acceptConfirmOpen = $state(false);
	// The family's explicit "Sign & send" (UAT #41): terms wait here until confirmed.
	let signTerms = $state<ContractTermsInput | null>(null);
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
			'contract.ended',
			'contract.billing'
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

	// The editor's selectable set: the provider's current listing, read from
	// the counterpart's public profile.
	const editorNeeded = $derived(contract !== null && contract.actions.canEditTerms);
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
			services: Array<{
				id: string;
				name: string;
				hourlyRateCents: number;
				floorRateCents: number;
			}>
		) => {
			if (loadedServicesFor !== key) return;
			editorServices = services.map((service) => ({
				id: service.id,
				name: service.name,
				hourlyRateCents: service.hourlyRateCents,
				floorRateCents: service.floorRateCents
			}));
		};
		const applyFailure = () => {
			if (loadedServicesFor !== key) return;
			loadedServicesFor = null;
			editorServicesError = true;
		};
		void getProvider(contract.counterpart.userId).then((result) =>
			result.ok ? applyServices(result.data.services) : applyFailure()
		);
	});

	/** TAX_PROVINCE_REQUIRED names whose address lacks a province; the viewer
	 * is told to fix their own, or that the other side has to. */
	const provinceRequiredMessage = (error: { code: string; message: string }) => {
		const party = (error as { party?: unknown }).party;
		const viewerSide = contract?.viewerSide ?? (role === 'family' ? 'family' : 'provider');
		const owner = party === 'family' || party === 'helper' ? party : null;
		if (owner === null || (owner === 'family') === (viewerSide === 'family')) {
			return viewerSide === 'family'
				? m.contracts_error_province_own_family()
				: m.contracts_error_province_own_helper();
		}
		return owner === 'family'
			? m.contracts_error_province_family()
			: m.contracts_error_province_helper();
	};

	const termsErrorToast = (error: { code: string; message: string }) => {
		if (error.code === 'RATE_BELOW_LISTED') {
			toast.error(m.contracts_error_rate_below_floor());
		} else if (error.code === 'UNKNOWN_CONTRACT_SERVICE') {
			toast.error(m.contracts_error_unknown_service({ name: firstName }));
		} else if (error.code === 'CONTRACT_SERVICE_NOT_AVAILABLE') {
			toast.error(m.contracts_error_service_not_available());
		} else if (error.code === 'EMPTY_CONTRACT_TERMS') {
			toast.error(m.contracts_error_empty_terms());
		} else if (error.code === 'INVALID_CONTRACT_TERMS') {
			toast.error(m.contracts_error_invalid_terms());
		} else if (error.code === 'CONTRACT_STATE_INVALID') {
			toast.error(m.contracts_error_moved_on());
			void refresh(contractId);
		} else if (error.code === 'START_DATE_REQUIRED') {
			toast.error(m.contracts_error_start_date_required());
		} else if (error.code === 'START_DATE_NOT_IN_FUTURE') {
			toast.error(m.contracts_error_start_date_not_future());
		} else if (error.code === 'FAMILY_LOCATION_REQUIRED') {
			toast.error(m.contracts_error_location_required());
		} else if (error.code === 'PAYMENT_METHOD_REQUIRED') {
			toast.error(m.contracts_error_payment_method_required(), {
				title: m.contracts_error_card_needed_title()
			});
			void refresh(contractId);
		} else if (error.code === 'TAX_PROVINCE_REQUIRED') {
			toast.error(provinceRequiredMessage(error), {
				title: m.contracts_error_province_needed_title()
			});
		} else {
			toast.error(m.contracts_error_generic());
		}
	};

	/** Decision/notice actions: a conflict means the contract moved on under
	 * the viewer — "try again" would loop, so refetch and let the fresh action
	 * flags redraw the page instead. */
	const actionErrorToast = (error: { code: string; message: string }, fallback: string) => {
		if (error.code === 'CONTRACT_START_DATE_PASSED') {
			toast.error(m.contracts_error_start_date_passed());
			void refresh(contractId);
			return;
		}
		if (
			error.code === 'CONTRACT_STATE_INVALID' ||
			error.code === 'CONTRACT_NOT_FOUND' ||
			error.code === 'CONTRACT_PROPOSAL_EXPIRED'
		) {
			toast.error(m.contracts_error_moved_on());
			void refresh(contractId);
		} else if (error.code === 'COUNTERPART_UNAVAILABLE') {
			toast.error(m.contracts_error_counterpart_unavailable());
		} else if (error.code === 'CONTRACT_SERVICE_NOT_AVAILABLE') {
			toast.error(m.contracts_error_service_not_available());
		} else if (error.code === 'TAX_PROVINCE_REQUIRED') {
			toast.error(provinceRequiredMessage(error), {
				title: m.contracts_error_province_needed_title()
			});
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
			toast.success(m.contracts_toast_draft_saved());
			void refresh(contractId);
		} else {
			termsErrorToast(result.error);
		}
	}

	/** B6: the price box follows the unsaved draft. An invalid draft (a rate
	 * below the floor, a half-built session) simply shows no price yet. */
	async function quoteDraft(terms: ContractTermsInput) {
		const result = await quoteContractTerms(contractId, terms);
		return result.ok ? result.data.pricing : null;
	}

	function handleSendTerms(terms: ContractTermsInput) {
		if (busy) return;
		signTerms = terms;
	}

	async function signAndSend() {
		const terms = signTerms;
		if (busy || !terms) return;
		signTerms = null;
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
			toast.success(m.contracts_toast_sent({ name: firstName }), {
				title: m.contracts_toast_sent_title()
			});
			void refresh(contractId);
		} else {
			termsErrorToast(sent.error);
		}
	}

	async function handleWithdraw() {
		if (busy) return;
		withdrawConfirmOpen = false;
		busy = true;
		const result = await withdrawContract(contractId);
		busy = false;
		if (result.ok) {
			toast.info(m.contracts_toast_withdrawn());
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, m.contracts_error_withdraw_failed());
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
			actionErrorToast(result.error, m.contracts_error_edit_failed());
		}
	}

	async function handleAccept() {
		if (busy) return;
		acceptConfirmOpen = false;
		busy = true;
		const result = await acceptContract(contractId);
		busy = false;
		if (result.ok) {
			toast.success(m.contracts_toast_accepted(), { title: m.contracts_toast_accepted_title() });
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, m.contracts_error_accept_failed());
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
			toast.info(m.contracts_toast_declined({ name: firstName }), {
				title: m.contracts_proposal_declined()
			});
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, m.contracts_error_decline_failed());
		}
	}

	async function handleRequestChanges() {
		if (busy) return;
		requestChangesConfirmOpen = false;
		busy = true;
		const result = await requestContractChanges(contractId);
		busy = false;
		if (result.ok) {
			toast.info(m.contracts_toast_changes_requested({ name: firstName }));
			void goto(withQuery(messagesHref, `c=${encodeURIComponent(result.data.conversationId)}`));
		} else {
			actionErrorToast(result.error, m.contracts_error_request_changes_failed());
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
			toast.info(m.contracts_toast_notice({ date: formatDateWithWeekday(result.data.endsOn) }), {
				title: m.contracts_toast_notice_title()
			});
			void refresh(contractId);
		} else {
			actionErrorToast(result.error, m.contracts_error_end_failed());
		}
	}

	// Recomputed each time the dialog opens (reading endOpen): the notice day in
	// the contract's zone plus 14 calendar days, or the signed terms' earlier
	// end (with its end time) — the same rule the server applies, so a
	// long-lived tab can't show a different date.
	const noticeEndsOn = $derived.by(() => {
		if (!endOpen || !contract?.timeZone) return '';
		const lastDay = noticeLastDay(todayIn(contract.timeZone), contract.acceptedVersion);
		return lastDay.endsAtMinutes
			? m.contracts_date_until({
					date: formatDateWithWeekday(lastDay.endsOn),
					time: formatEndTime(lastDay.endsAtMinutes)
				})
			: formatDateWithWeekday(lastDay.endsOn);
	});

	/** The latest version that was actually declined — `latestVersion` may
	 * already be the family's fresh revision draft, which never carries the
	 * decline reason. */
	const latestDeclined = $derived(
		[...(contract?.versions ?? [])].reverse().find((version) => version.status === 'declined') ??
			null
	);

	const chip = $derived.by((): { status: ChipStatus; label?: string } => {
		if (!contract) return { status: 'empty' };
		// An expired proposal can still be declined, but it no longer awaits you.
		if (
			contract.status === 'proposed' &&
			contract.pendingVersion &&
			!contract.pendingVersion.proposedByMe &&
			contract.actions.canDecline
		) {
			return { status: 'awaiting-you' };
		}
		if (contract.status === 'changes_requested') return { status: 'changes-requested' };
		// B5: billing paused — never show "Active" for a suspended contract.
		if (contract.status === 'active' && contract.billing?.status === 'suspended') {
			return { status: 'suspended', label: suspendedLabel(contract.billing.suspendedReason) };
		}
		return { status: contract.status as ChipStatus };
	});

	function suspendedLabel(reason: string | null): string {
		switch (reason) {
			case 'card':
				return m.contracts_suspended_card();
			case 'helper_not_ready':
				return m.contracts_suspended_helper_payouts();
			case 'provider_unavailable':
				return m.contracts_suspended_helper_unavailable();
			default:
				return m.contracts_suspended();
		}
	}

	const subtitle = $derived.by(() => {
		if (!contract) return '';
		const pending = contract.pendingVersion;
		const accepted = contract.acceptedVersion;
		const latest = contract.latestVersion;
		// Parts are joined with " · " — each part is a whole localized phrase.
		const parts = (...items: Array<string | null | false | undefined>) =>
			items.filter(Boolean).join(' · ');
		switch (contract.status) {
			case 'draft':
				return m.contracts_subtitle_draft({ version: latest?.version ?? 1 });
			case 'proposed':
			case 'expired':
				return pending
					? parts(
							pending.proposedByMe
								? m.contracts_subtitle_proposed_by_you({ version: pending.version })
								: m.contracts_subtitle_proposed_by_name({
										name: firstName,
										version: pending.version
									}),
							pending.sentAt && m.contracts_subtitle_sent({ date: formatDateTime(pending.sentAt) })
						)
					: '';
			case 'changes_requested':
				return m.contracts_subtitle_changes_requested({ version: latest?.version ?? 1 });
			case 'declined':
				return latestDeclined
					? parts(
							latestDeclined.proposedByMe
								? m.contracts_subtitle_declined_by_name({
										name: firstName,
										version: latestDeclined.version
									})
								: m.contracts_subtitle_declined_by_you({ version: latestDeclined.version }),
							latestDeclined.decidedAt && formatDate(latestDeclined.decidedAt)
						)
					: '';
			case 'active':
				return accepted
					? parts(
							accepted.familySignedAt
								? m.contracts_subtitle_signed_both_dates({
										version: accepted.version,
										family: formatDate(accepted.familySignedAt),
										helper: accepted.decidedAt ? formatDate(accepted.decidedAt) : '—'
									})
								: m.contracts_subtitle_signed_both({ version: accepted.version }),
							accepted.decidedAt &&
								m.contracts_subtitle_active_since({ date: formatDate(accepted.decidedAt) })
						)
					: '';
			case 'ending':
				return contract.endsOn
					? m.contracts_subtitle_ending_on({ date: formatDate(contract.endsOn) })
					: m.contracts_subtitle_ending();
			case 'ended':
				return contract.endsOn
					? m.contracts_subtitle_ended_on({ date: formatDate(contract.endsOn) })
					: m.contracts_subtitle_ended();
			default:
				return '';
		}
	});

	/** The read-only terms shown when the editor isn't (receiver views, active
	 * contracts, the dimmed declined terms). */
	const displayTerms = $derived.by(() => {
		if (!contract) return null;
		return contract.acceptedVersion ?? contract.pendingVersion ?? contract.latestVersion;
	});

	const showEditor = $derived(contract !== null && contract.actions.canEditTerms);

	/** F5's clash-checking tool: the combined week strip renders wherever the
	 * terms are read-only and there is at least one session to show. */
	const weekGlanceServices = $derived(
		displayTerms !== null && !showEditor
			? displayTerms.services.filter((service) => service.sessions.length > 0)
			: []
	);

	const reviewTotals = $derived.by(() => {
		const pending = contract?.pendingVersion;
		if (!pending) return null;
		const sessionCount = pending.services.reduce(
			(total, service) => total + service.sessions.length,
			0
		);
		const minutes = pending.services.reduce(
			(total, service) => total + weeklyMinutes(service.sessions),
			0
		);
		return {
			sessions: sessionCount,
			hours: minutesToHours(minutes),
			weekly: formatMoney(pending.weeklyEstimateCents)
		};
	});
	const versionsNewestFirst = $derived([...(contract?.versions ?? [])].reverse());

	const historyLine = (version: NonNullable<typeof contract>['versions'][number]) => {
		const who = version.proposedByMe ? m.contracts_history_you() : firstName;
		const statusLabel: Record<string, string> = {
			draft: m.contracts_history_drafted({ who }),
			proposed: m.contracts_history_proposed({ who }),
			accepted: m.contracts_history_accepted({ who }),
			superseded: m.contracts_history_superseded(),
			declined: m.contracts_history_declined({ who }),
			changes_requested: m.contracts_history_changes_requested({ who }),
			withdrawn: m.contracts_history_withdrawn({ who })
		};
		const at = version.decidedAt ?? version.sentAt;
		return `v${version.version} ${statusLabel[version.status] ?? version.status}${at ? ` · ${formatDate(at)}` : ''}`;
	};
</script>

<svelte:head>
	<title>
		{contract
			? m.contracts_detail_page_title({ name: contract.counterpart.name })
			: m.contracts_detail_page_title_loading()}
	</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-4">
	<a
		href={listHref}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		{m.contracts_list_title()}
	</a>

	{#if loading && !contract}
		<div class="flex justify-center py-24">
			<span class="loading loading-lg loading-spinner text-primary"></span>
		</div>
	{:else if loadError && !contract}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<p class="text-sm font-medium text-error" role="alert">{m.contracts_detail_load_error()}</p>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => (retryTick = retryTick + 1)}
			>
				<i class="las la-redo-alt" aria-hidden="true"></i>
				{m.contracts_retry()}
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
					{m.contracts_detail_title({ name: contract.counterpart.name })}
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
					{m.contracts_banner_waiting({ name: firstName })}
					{#if contract.pendingVersion.expiresAt}
						{m.contracts_banner_expires({ date: formatDate(contract.pendingVersion.expiresAt) })}
					{/if}
				</p>
			</div>
		{:else if contract.status === 'expired'}
			<div class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3">
				<i class="las la-hourglass-end mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-neutral">
					{#if contract.acceptBlockedReason === 'start_date_passed'}
						{m.contracts_banner_start_passed()}
						{#if contract.viewerSide === 'family'}
							{m.contracts_banner_start_passed_family()}
						{:else}
							{m.contracts_banner_start_passed_provider({ name: firstName })}
						{/if}
					{:else}
						{m.contracts_banner_expired()}
						{#if contract.viewerSide === 'family'}
							{m.contracts_banner_expired_family()}
						{:else}
							{m.contracts_banner_expired_provider({ name: firstName })}
						{/if}
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
						{m.contracts_banner_changes_family({ name: firstName })}
					{:else}
						{m.contracts_banner_changes_provider({ name: firstName })}
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
						{latestDeclined?.declineReason
							? m.contracts_banner_declined_reason({
									name: firstName,
									reason: latestDeclined.declineReason
								})
							: m.contracts_banner_declined({ name: firstName })}
						{m.contracts_banner_declined_chat_open()}
					</p>
				</div>
			{:else}
				<!-- 16j: the decliner gets a quiet neutral state, not an alarm. -->
				<div
					class="flex items-start gap-2.5 rounded-lg border border-base-600 bg-base-300 px-4 py-3"
				>
					<i class="las la-info-circle mt-0.5 shrink-0 text-neutral" aria-hidden="true"></i>
					<p class="text-[12.5px] leading-relaxed text-neutral">
						{latestDeclined?.declineReason
							? m.contracts_banner_you_declined_reason({
									name: firstName,
									reason: latestDeclined.declineReason
								})
							: m.contracts_banner_you_declined({ name: firstName })}
					</p>
				</div>
			{/if}
		{:else if contract.status === 'active'}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-content px-4 py-3"
			>
				<i class="las la-check-circle mt-0.5 shrink-0 text-success" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-success">
					{#if contract.viewerSide === 'family'}
						{m.contracts_banner_active_family()}
					{:else}
						{m.contracts_banner_active_provider()}
					{/if}
					{#if contract.endsOn}
						{m.contracts_banner_runs_until_before()}
						<strong
							>{contract.endsAtMinutes
								? m.contracts_date_at_time({
										date: formatDateWithWeekday(contract.endsOn),
										time: formatEndTime(contract.endsAtMinutes)
									})
								: formatDateWithWeekday(contract.endsOn)}</strong
						>{m.contracts_banner_runs_until_after()}
					{/if}
				</p>
			</div>
		{:else if contract.status === 'ending' || contract.status === 'ended'}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error-content px-4 py-3"
			>
				<i class="las la-clock mt-0.5 shrink-0 text-error" aria-hidden="true"></i>
				<p class="text-[12.5px] leading-relaxed text-error">
					{#if contract.endNoticedAt}
						{contract.endedByMe
							? m.contracts_banner_notice_by_you({ date: formatDate(contract.endNoticedAt) })
							: m.contracts_banner_notice_by_name({
									name: firstName,
									date: formatDate(contract.endNoticedAt)
								})}
					{:else}
						{contract.status === 'ended'
							? m.contracts_banner_reached_end()
							: m.contracts_banner_reaches_end()}
					{/if}
					{#if contract.endsOn}
						{contract.status === 'ended'
							? m.contracts_banner_last_day_was()
							: m.contracts_banner_last_day_is()}
						<strong
							>{contract.endsAtMinutes
								? m.contracts_date_until({
										date: formatDateWithWeekday(contract.endsOn),
										time: formatEndTime(contract.endsAtMinutes)
									})
								: formatDateWithWeekday(contract.endsOn)}</strong
						>
						{m.contracts_banner_last_day_after()}
					{/if}
					{#if contract.endNote && !contract.endedByMe}
						{m.contracts_banner_note({ note: contract.endNote })}
					{/if}
				</p>
			</div>
		{/if}

		<div class="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
			<div class="flex min-w-0 flex-col gap-4">
				{#if showEditor}
					{#if editorServicesError}
						<p class="rounded-lg bg-base-300 px-4 py-3 text-[12.5px] text-neutral" role="alert">
							{m.contracts_detail_services_error({ name: firstName })}
						</p>
					{/if}
					<ContractTermsEditor
						providerServices={editorServices}
						initial={contract.pendingVersion ?? contract.latestVersion}
						listingLabel={m.contracts_listing_label({ name: firstName })}
						counterpartFirstName={firstName}
						{chatHref}
						earliestStartsOn={contract.earliestStartsOn}
						timeZoneLabel={contract.timeZoneLabel}
						locationMissing={contract.timeZone === null}
						profileHref={resolve('/family/profile')}
						paymentMethodMissing={contract.hasPaymentMethod === false}
						billingHref={resolve('/family/billing')}
						pricing={contract.pendingVersion?.status === 'draft'
							? contract.pendingVersion.pricing
							: null}
						onquote={quoteDraft}
						{busy}
						onsave={handleSaveDraft}
						onsend={handleSendTerms}
					/>
				{:else if displayTerms}
					{#if weekGlanceServices.length > 0}
						<WeekAtAGlance
							services={weekGlanceServices}
							agreed={displayTerms.status === 'accepted'}
						/>
					{/if}
					<ContractTermsView
						terms={displayTerms}
						dimmed={contract.status === 'declined' || contract.status === 'expired'}
						heading={contract.status === 'declined'
							? m.contracts_detail_declined_terms_heading({ version: displayTerms.version })
							: m.contracts_terms_heading()}
						timeZoneLabel={contract.timeZoneLabel}
						viewerIsFamily={contract.viewerSide === 'family'}
					/>
				{/if}

				{#if contract.billing}
					<ContractBillingPanel
						billing={contract.billing}
						viewerSide={contract.viewerSide}
						counterpartFirstName={firstName}
						billingHref={resolve('/family/billing')}
						payoutsHref={resolve('/service-provider/payouts')}
					/>
				{/if}

				{#if contract.actions.canEnd}
					<div
						class="flex items-center gap-4 rounded-xl border border-card-border bg-base-100 px-5
							py-4"
					>
						<div class="min-w-0 flex-1">
							<h3 class="font-display text-[13.5px] font-bold text-base-content">
								{m.contracts_end_card_title()}
							</h3>
							<p class="mt-0.5 text-[12px] leading-relaxed text-base-content-muted">
								{m.contracts_end_card_body()}
							</p>
						</div>
						<button
							type="button"
							class="btn btn-outline btn-sm shrink-0 btn-error"
							disabled={busy}
							onclick={() => (endOpen = true)}
						>
							{m.contracts_end_card_button()}
						</button>
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-4">
				{#if contract.actions.canAccept || contract.actions.canDecline || contract.actions.canRequestChanges}
					<div class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4">
						{#if contract.actions.canAccept}
							<button
								type="button"
								class="btn w-full btn-primary"
								disabled={busy}
								onclick={() => (acceptConfirmOpen = true)}
							>
								{m.contracts_accept_sign()}
							</button>
						{/if}
						{#if contract.acceptBlockedReason === 'start_date_passed'}
							<p
								class="rounded-lg bg-base-300 px-3 py-2 text-[12px] leading-relaxed text-neutral"
								role="status"
							>
								{m.contracts_start_passed_ask({ name: firstName })}
							</p>
						{/if}
						{#if contract.actions.canRequestChanges}
							<button
								type="button"
								class="btn w-full btn-outline"
								disabled={busy}
								onclick={() => (requestChangesConfirmOpen = true)}
							>
								{m.contracts_request_changes()}
							</button>
						{/if}
						{#if contract.actions.canDecline}
							<button
								type="button"
								class="btn w-full btn-ghost text-error"
								disabled={busy}
								onclick={() => (declineOpen = true)}
							>
								{m.contracts_decline()}
							</button>
						{/if}
						{#if reviewTotals}
							<p class="text-center text-[11px] leading-relaxed text-outline">
								{m.contracts_review_sessions({ count: reviewTotals.sessions })} · {m.contracts_hours_per_week(
									{ hours: reviewTotals.hours }
								)} · {m.contracts_per_week({ amount: reviewTotals.weekly })}
							</p>
						{/if}
						<p class="text-center text-[11px] leading-relaxed text-outline">
							{m.contracts_review_chat_hint({ name: firstName })}
							{#if contract.pendingVersion?.expiresAt}
								· {m.contracts_review_expires({
									date: formatDate(contract.pendingVersion.expiresAt)
								})}{/if}
						</p>
					</div>
				{/if}

				{#if contract.actions.canWithdraw}
					<div class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4">
						<button
							type="button"
							class="btn w-full btn-outline"
							disabled={busy}
							onclick={handleEditProposal}
						>
							{m.contracts_edit_proposal()}
						</button>
						<button
							type="button"
							class="btn w-full btn-ghost text-error"
							disabled={busy}
							onclick={() => (withdrawConfirmOpen = true)}
						>
							{m.contracts_withdraw()}
						</button>
						<p class="text-center text-[11px] leading-relaxed text-outline">
							{m.contracts_withdraw_hint()}
						</p>
					</div>
				{/if}

				{#if contract.counterpartContact}
					<div class="rounded-xl border border-card-border bg-base-100 p-4">
						<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
							{m.contracts_contact_heading({ name: firstName })}
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
							{m.contracts_contact_locked()}
						</p>
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					{#if chatHref}
						<a href={chatHref} class="btn w-full btn-outline btn-sm">
							{m.contracts_open_chat({ name: firstName })}
						</a>
					{/if}
				</div>

				<div class="rounded-xl border border-card-border bg-base-100 p-4">
					<h3 class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
						{m.contracts_history_heading()}
					</h3>
					<ul class="flex flex-col gap-1 text-[12px] leading-relaxed text-base-content-muted">
						{#each versionsNewestFirst as version (version.version)}
							<li>{historyLine(version)}</li>
						{/each}
						{#if contract.conversationStartedAt}
							<li>
								{m.contracts_history_conversation_started({
									date: formatDate(contract.conversationStartedAt)
								})}
							</li>
						{/if}
					</ul>
				</div>
			</div>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={acceptConfirmOpen}
	title={m.contracts_accept_dialog_title()}
	body={m.contracts_accept_dialog_body()}
	confirmLabel={m.contracts_accept_sign()}
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleAccept}
	oncancel={() => (acceptConfirmOpen = false)}
>
	{#if role === 'service-provider' && contract?.payoutsReady === false}
		<PayoutsReminder />
	{/if}
</ConfirmDialog>

<ConfirmDialog
	open={signTerms !== null}
	title={m.contracts_sign_dialog_title()}
	body={m.contracts_sign_dialog_body({ name: firstName })}
	confirmLabel={m.contracts_sign_send()}
	confirmClass="btn-primary"
	{busy}
	onconfirm={() => void signAndSend()}
	oncancel={() => (signTerms = null)}
/>

<ConfirmDialog
	open={withdrawConfirmOpen}
	title={m.contracts_withdraw_dialog_title()}
	body={m.contracts_withdraw_dialog_body({ name: firstName })}
	confirmLabel={m.contracts_withdraw()}
	{busy}
	onconfirm={handleWithdraw}
	oncancel={() => (withdrawConfirmOpen = false)}
/>

<ConfirmDialog
	open={requestChangesConfirmOpen}
	title={m.contracts_request_changes_dialog_title()}
	body={m.contracts_request_changes_dialog_body({ name: firstName })}
	confirmLabel={m.contracts_request_changes()}
	confirmClass="btn-primary"
	{busy}
	onconfirm={handleRequestChanges}
	oncancel={() => (requestChangesConfirmOpen = false)}
/>

{#if declineOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={m.contracts_decline_dialog_aria()}>
		<div class="modal-box max-w-md border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.contracts_decline_dialog_title()}
			</h3>
			<p class="py-3 text-sm text-base-content-muted">
				{m.contracts_decline_dialog_body({ name: firstName })}
			</p>
			<label
				class="mb-1 block text-[11px] font-semibold tracking-[0.08em] text-outline uppercase"
				for="decline-reason"
			>
				{m.contracts_decline_reason_label()}
			</label>
			<textarea
				id="decline-reason"
				class="textarea w-full text-[13px]"
				rows={2}
				maxlength={1000}
				placeholder={m.contracts_decline_reason_placeholder()}
				bind:value={declineReason}
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={() => (declineOpen = false)}
				>
					{m.common_cancel()}
				</button>
				<button type="button" class="btn btn-error" disabled={busy} onclick={handleDecline}>
					{#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
					{m.contracts_decline()}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (declineOpen = false)}
			aria-label={m.common_close()}
		></button>
	</div>
{/if}

{#if endOpen}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={m.contracts_end_dialog_aria()}>
		<div class="modal-box max-w-md border border-card-border">
			<h3 class="font-display text-xl font-bold text-base-content">
				{m.contracts_end_dialog_title()}
			</h3>
			<p class="py-3 text-sm text-base-content-muted">
				{m.contracts_end_dialog_before()}
				<strong class="text-base-content">{noticeEndsOn}</strong>
				{m.contracts_end_dialog_after({ name: firstName })}
			</p>
			<textarea
				class="textarea w-full text-[13px]"
				rows={2}
				maxlength={1000}
				placeholder={m.contracts_end_note_placeholder({ name: firstName })}
				bind:value={endNote}
			></textarea>
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={busy}
					onclick={() => (endOpen = false)}
				>
					{m.contracts_keep_contract()}
				</button>
				<button type="button" class="btn btn-error" disabled={busy} onclick={handleEnd}>
					{#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
					{m.contracts_give_notice()}
				</button>
			</div>
		</div>
		<button
			type="button"
			class="modal-backdrop"
			onclick={() => (endOpen = false)}
			aria-label={m.common_close()}
		></button>
	</div>
{/if}
