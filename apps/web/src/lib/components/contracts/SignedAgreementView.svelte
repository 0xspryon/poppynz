<script lang="ts">
	/** The signed service agreement of a contract (UAT round 2, item 4): who
	 * signed which agreement version of which terms, when, and the exact text
	 * each signed — printable and downloadable. Used in the contract page's
	 * dialog and on the admin's signed-agreement page. */
	import {
		getSignedAgreement,
		shortHash,
		type AgreementSignature,
		type SignedAgreement
	} from '$lib/api/agreements';
	import { agreementErrorToast } from '$lib/agreement-errors';
	import { downloadAgreement, printAgreement } from '$lib/agreement-print';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { formatDateTime } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	let { contractId }: { contractId: string } = $props();

	let agreement = $state<SignedAgreement | null>(null);
	let loading = $state(true);
	let loadFailed = $state(false);
	let selectedId = $state<string | null>(null);

	let loadSeq = 0;
	async function load(id: string) {
		loadSeq += 1;
		const seq = loadSeq;
		loading = true;
		loadFailed = false;
		const result = await getSignedAgreement(id);
		if (seq !== loadSeq) return;
		loading = false;
		if (result.ok) {
			agreement = result.data.agreement;
			const first =
				agreement.signatures.find((signature) => signature.counts) ?? agreement.signatures[0];
			selectedId = first?.id ?? null;
		} else {
			agreement = null;
			loadFailed = true;
			if (!agreementErrorToast(result.error)) toast.error(m.agreement_load_failed());
		}
	}

	$effect(() => {
		void load(contractId);
	});

	const counting = $derived(agreement?.signatures.filter((signature) => signature.counts) ?? []);
	const history = $derived(agreement?.signatures.filter((signature) => !signature.counts) ?? []);
	const selected = $derived(
		agreement?.signatures.find((signature) => signature.id === selectedId) ?? null
	);
	const sameText = $derived(
		counting.length === 2 ? counting[0]!.sha256 === counting[1]!.sha256 : null
	);

	const sideLabel = (side: AgreementSignature['side']) =>
		side === 'family' ? m.agreement_side_family() : m.agreement_side_helper();
	const languageLabel = (locale: AgreementSignature['locale']) =>
		locale === 'fr' ? m.agreement_language_fr() : m.agreement_language_en();

	const signingLines = () =>
		(counting.length > 0 ? counting : selected ? [selected] : []).map((signature) =>
			m.agreement_print_signed_line({
				name: signature.signerName,
				side: sideLabel(signature.side),
				date: formatDateTime(signature.signedAt),
				hash: signature.sha256
			})
		);

	function print() {
		if (!selected) return;
		const title = agreement?.title ?? m.agreement_signed_title();
		if (!printAgreement(title, selected.content, signingLines())) {
			downloadAgreement(`service-agreement-${contractId}.md`, selected.content, signingLines());
		}
	}

	function download() {
		if (!selected) return;
		downloadAgreement(
			`service-agreement-${contractId}-v${selected.contractVersion}-${selected.side}.md`,
			selected.content,
			signingLines()
		);
	}
</script>

{#snippet signatureCard(signature: AgreementSignature)}
	<li
		class="rounded-lg border px-4 py-3 {signature.id === selectedId
			? 'border-primary bg-primary/5'
			: 'border-card-border bg-base-100'}"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-sm font-semibold text-base-content">
				<span class="badge badge-sm mr-1.5 border-0 bg-base-400 font-semibold text-info">
					{sideLabel(signature.side)}
				</span>
				{signature.signerName}
			</p>
			{#if signature.id !== selectedId}
				<button
					type="button"
					class="btn btn-ghost btn-xs"
					onclick={() => (selectedId = signature.id)}
				>
					{m.agreement_signed_show()}
				</button>
			{/if}
		</div>
		<p class="mt-1 text-[12.5px] text-base-content">
			{m.agreement_signed_at({ date: formatDateTime(signature.signedAt) })}
		</p>
		<p class="mt-0.5 font-mono text-[11px] break-all text-base-content-muted">
			{m.agreement_signed_meta({
				template: signature.templateVersion,
				terms: signature.contractVersion,
				language: languageLabel(signature.locale),
				hash: shortHash(signature.sha256)
			})}
		</p>
		{#if signature.cancellationPolicyVersion !== null}
			<p class="mt-0.5 text-[11.5px] text-base-content-muted">
				{m.agreement_signed_policy({ version: signature.cancellationPolicyVersion })}
			</p>
		{/if}
		{#if !signature.counts}
			<p class="mt-1 text-[11.5px] font-semibold text-warning">
				{signature.voidedAt ? m.agreement_signed_voided() : m.agreement_signed_older_terms()}
			</p>
		{/if}
	</li>
{/snippet}

{#if loading}
	<div class="flex justify-center py-12">
		<span class="loading loading-spinner loading-md text-primary"></span>
	</div>
{:else if loadFailed}
	<div class="flex justify-center py-12">
		<button type="button" class="btn btn-sm" onclick={() => void load(contractId)}>
			<i class="las la-redo-alt" aria-hidden="true"></i>
			{m.agreement_retry()}
		</button>
	</div>
{:else if agreement}
	{#if agreement.signatures.length === 0}
		<p class="py-6 text-sm text-base-content-muted">{m.agreement_signed_none()}</p>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each counting as signature (signature.id)}
				{@render signatureCard(signature)}
			{/each}
		</ul>
		{#if counting.length === 0}
			<p class="py-2 text-sm text-base-content-muted">{m.agreement_signed_none()}</p>
		{/if}
		{#if sameText !== null}
			<p class="mt-2 flex items-center gap-1.5 text-[12.5px] text-base-content-muted">
				<i
					class="las {sameText ? 'la-check-circle text-success' : 'la-info-circle'}"
					aria-hidden="true"
				></i>
				{sameText ? m.agreement_signed_identical() : m.agreement_signed_different()}
			</p>
		{/if}
		{#if history.length > 0}
			<details class="mt-3">
				<summary class="cursor-pointer text-[12.5px] font-semibold text-base-content-muted">
					{m.agreement_signed_history()} ({history.length})
				</summary>
				<ul class="mt-2 flex flex-col gap-2">
					{#each history as signature (signature.id)}
						{@render signatureCard(signature)}
					{/each}
				</ul>
			</details>
		{/if}

		{#if selected}
			<div class="mt-5 flex flex-wrap items-center justify-between gap-2">
				<p class="text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
					{m.agreement_signed_showing({ name: selected.signerName })}
				</p>
				<div class="flex gap-1.5">
					<button type="button" class="btn btn-ghost btn-sm" onclick={print}>
						<i class="las la-print" aria-hidden="true"></i>
						{m.agreement_print()}
					</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={download}>
						<i class="las la-download" aria-hidden="true"></i>
						{m.agreement_download()}
					</button>
				</div>
			</div>
			<div
				class="mt-2 max-h-[28rem] overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-4"
				lang={selected.locale}
				data-testid="signed-agreement-text"
			>
				<MarkdownView content={selected.content} />
			</div>
		{/if}
	{/if}
{/if}
