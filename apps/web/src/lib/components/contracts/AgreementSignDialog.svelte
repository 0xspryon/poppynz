<script lang="ts">
	/** The written service agreement shown before signing (UAT round 2, item
	 * 4): the family's Sign & send and the helper's Accept & sign. The text is
	 * rendered by the API from the terms being signed; signing echoes back its
	 * template row and hash, and needs the explicit "I have read and agree"
	 * tick. When the text changed meanwhile, the dialog reloads it and asks
	 * for a fresh tick. */
	import { untrack, type Snippet } from 'svelte';
	import {
		getAgreementToSign,
		type AgreementAssent,
		type AgreementToSign
	} from '$lib/api/agreements';
	import { agreementErrorToast, type AgreementSignOutcome } from '$lib/agreement-errors';
	import { printAgreement } from '$lib/agreement-print';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		open: boolean;
		contractId: string;
		/** send: the family's Sign & send; accept: the helper's Accept & sign. */
		action: 'send' | 'accept';
		counterpartName: string;
		busy?: boolean;
		onsign: (assent: AgreementAssent) => Promise<AgreementSignOutcome>;
		oncancel: () => void;
		/** Extra content above the tick (e.g. the payouts reminder). */
		children?: Snippet;
	}

	let {
		open,
		contractId,
		action,
		counterpartName,
		busy = false,
		onsign,
		oncancel,
		children
	}: Props = $props();

	let agreement = $state<AgreementToSign | null>(null);
	let loading = $state(false);
	let loadFailed = $state(false);
	let checked = $state(false);

	let loadSeq = 0;
	async function load() {
		loadSeq += 1;
		const seq = loadSeq;
		loading = true;
		loadFailed = false;
		checked = false;
		const result = await getAgreementToSign(contractId);
		if (seq !== loadSeq) return;
		loading = false;
		if (result.ok) {
			agreement = result.data.agreement;
			return;
		}
		agreement = null;
		loadFailed = true;
		if (!agreementErrorToast(result.error)) toast.error(m.agreement_load_failed());
	}

	$effect(() => {
		if (open) {
			untrack(() => void load());
		} else {
			loadSeq += 1;
			agreement = null;
			checked = false;
			loadFailed = false;
		}
	});

	const checkboxLabel = $derived(
		agreement
			? agreement.fallback
				? m.agreement_checkbox_fallback()
				: agreement.checkboxLabel
			: ''
	);

	async function sign() {
		if (!agreement || !checked || busy) return;
		const outcome = await onsign({ versionId: agreement.versionId, sha256: agreement.sha256 });
		if (outcome === 'changed' && open) await load();
	}

	function print() {
		if (!agreement) return;
		printAgreement(agreement.title, agreement.content, [
			m.agreement_sign_version({ version: agreement.version })
		]);
	}
</script>

{#if open}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={m.agreement_sign_title()}
	>
		<div class="modal-box flex max-h-[90vh] max-w-3xl flex-col border border-card-border p-0">
			<div class="border-b border-base-300 px-6 py-4">
				<h2 class="font-display text-lg font-bold text-base-content">{m.agreement_sign_title()}</h2>
				<p class="mt-1 text-[13px] text-base-content-muted">
					{action === 'send'
						? m.agreement_sign_intro_send({ name: counterpartName })
						: m.agreement_sign_intro_accept({ name: counterpartName })}
				</p>
				{#if agreement}
					<p class="mt-1 text-[11.5px] font-semibold text-outline">
						{agreement.title} · {m.agreement_sign_version({ version: agreement.version })}
					</p>
				{/if}
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-6 py-4" data-testid="agreement-text">
				{#if loading}
					<div class="flex items-center justify-center gap-2 py-16 text-sm text-base-content-muted">
						<span class="loading loading-spinner loading-sm text-primary"></span>
						{m.agreement_loading()}
					</div>
				{:else if loadFailed}
					<div class="flex justify-center py-16">
						<button type="button" class="btn btn-sm" onclick={() => void load()}>
							<i class="las la-redo-alt" aria-hidden="true"></i>
							{m.agreement_retry()}
						</button>
					</div>
				{:else if agreement}
					{#if agreement.fallback}
						<p
							class="mb-3 flex items-center gap-2 rounded-md border border-info-content bg-info-content/40
								px-3 py-2 text-[13px] text-info"
						>
							<i class="las la-language text-base" aria-hidden="true"></i>
							{m.tc_english_governs_notice()}
						</p>
					{/if}
					<div lang={agreement.locale}>
						<MarkdownView content={agreement.content} />
					</div>
				{/if}
			</div>

			<div class="border-t border-base-300 bg-base-200 px-6 py-4">
				{#if children}
					<div class="mb-3">{@render children()}</div>
				{/if}
				<label class="label items-start gap-2.5 text-sm whitespace-normal text-base-content">
					<input
						type="checkbox"
						class="checkbox checkbox-primary checkbox-sm"
						bind:checked
						disabled={busy || !agreement}
					/>
					<span>{checkboxLabel || m.agreement_checkbox_fallback()}</span>
				</label>
				<div class="mt-4 flex flex-wrap justify-end gap-2.5">
					<button type="button" class="btn btn-ghost mr-auto" onclick={print} disabled={!agreement}>
						<i class="las la-print" aria-hidden="true"></i>
						{m.agreement_print()}
					</button>
					<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
						{m.common_cancel()}
					</button>
					<button
						type="button"
						class="btn btn-primary"
						disabled={!agreement || !checked || busy}
						onclick={() => void sign()}
					>
						{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
						{action === 'send' ? m.contracts_sign_send() : m.contracts_accept_sign()}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
