<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		createTcDraft,
		getAdminTc,
		publishTcDraft,
		tcAudienceLabel,
		updateTcDocument,
		updateTcDraft,
		type AdminTcDocument,
		type AdminTcVersion,
		type TcDocumentDraft,
		type TcLocale
	} from '$lib/api/tcs';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	// Service agreement templates (UAT round 2, item 4).
	import AgreementPlaceholderReference from '$lib/components/admin/AgreementPlaceholderReference.svelte';
	import AgreementSignaturesList from '$lib/components/admin/AgreementSignaturesList.svelte';
	import AgreementTemplatePreview from '$lib/components/admin/AgreementTemplatePreview.svelte';
	import { agreementIssueText, templateIssuesOf } from '$lib/agreement-errors';
	import TcDocumentDialog from '$lib/components/admin/TcDocumentDialog.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import TcModal from '$lib/components/TcModal.svelte';
	import { formatDate } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const documentId = $derived(page.params.id ?? '');

	// Generic form on purpose: an annotated `= $state(null)` narrows `doc` to
	// null for the top-level $derived reads below.
	let doc = $state<AdminTcDocument | null>(null);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);

	// Details dialog
	let detailsOpen = $state(false);
	let detailsBusy = $state(false);

	// Draft editor. The form is local until saved: Save creates the draft row
	// (or patches the open one); Publish freezes it as the next version.
	let editorOpen = $state(false);
	let draftDescription = $state('');
	let draftContent = $state('');
	let draftCheckboxLabel = $state('');
	let draftBusy = $state(false);
	let showPreview = $state(false);

	let publishConfirmOpen = $state(false);
	let publishBusy = $state(false);

	let viewing = $state<AdminTcVersion | null>(null);

	// U7: each language has its own drafts; English governs and numbers the
	// versions, a French version translates one (written by a person).
	let editingLocale = $state<TcLocale>('en');
	const localeOf = (version: AdminTcVersion): TcLocale => (version.locale === 'fr' ? 'fr' : 'en');
	const localeVersions = $derived(
		doc?.versions.filter((version) => localeOf(version) === editingLocale) ?? []
	);
	const serverDraft = $derived(
		localeVersions.find((version) => version.publishedAt === null) ?? null
	);
	const latestPublished = $derived(
		localeVersions.find((version) => version.publishedAt !== null) ?? null
	);
	/** The authoritative revision the header reports. */
	const latestPublishedEnglish = $derived(
		doc?.versions.find(
			(version) => localeOf(version) === 'en' && version.publishedAt !== null
		) ?? null
	);
	const draftDirty = $derived(
		serverDraft === null ||
			serverDraft.description !== draftDescription ||
			serverDraft.content !== draftContent ||
			serverDraft.checkboxLabel !== draftCheckboxLabel
	);
	const canSaveDraft = $derived(
		draftDescription.trim().length > 0 &&
			draftContent.trim().length > 0 &&
			draftCheckboxLabel.trim().length > 0
	);

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? m.admin_tcs_error_forbidden()
			: error.code === 'UNAUTHORIZED'
				? m.admin_tcs_error_session()
				: m.admin_tcs_error_retry();

	async function load() {
		loading = true;
		const result = await getAdminTc(documentId);
		if (result.ok) {
			doc = result.data;
			errorMessage = null;
			syncEditorWithDraft();
		} else {
			errorMessage = errorText(result.error);
		}
		loading = false;
	}

	$effect(() => {
		if (documentId) void load();
	});

	/** Open the editor on this language's draft, if it has one. */
	function syncEditorWithDraft() {
		const openDraft = doc?.versions.find(
			(version) => localeOf(version) === editingLocale && version.publishedAt === null
		);
		editorOpen = openDraft !== undefined;
		if (openDraft) {
			draftDescription = openDraft.description;
			draftContent = openDraft.content;
			draftCheckboxLabel = openDraft.checkboxLabel;
		}
		showPreview = false;
	}

	function switchLocale(locale: TcLocale) {
		if (locale === editingLocale) return;
		editingLocale = locale;
		syncEditorWithDraft();
	}

	function openNewDraft() {
		// Start from the latest published text so the admin edits, not retypes;
		// a first French version starts from the English text to translate.
		const base = latestPublished ?? (editingLocale === 'fr' ? latestPublishedEnglish : null);
		draftDescription = '';
		draftContent = base?.content ?? '';
		draftCheckboxLabel = base?.checkboxLabel ?? '';
		showPreview = false;
		editorOpen = true;
	}

	const isAgreement = $derived(doc?.kind === 'service_agreement');

	const draftErrorText = (error: { code: string; message: string }) =>
		error.code === 'TC_TEMPLATE_INVALID'
			? templateIssuesOf(error).slice(0, 3).map(agreementIssueText).join(' · ')
			: error.code === 'TC_TRANSLATION_BASE_MISSING'
			? m.admin_tcs_error_translation_base()
			: error.code === 'TC_TRANSLATION_EXISTS'
				? m.admin_tcs_error_translation_exists()
				: errorText(error);

	async function saveDetails(details: TcDocumentDraft) {
		if (detailsBusy || !doc) return;
		detailsBusy = true;
		const result = await updateTcDocument(doc.id, {
			title: details.title,
			appliesToRole: details.appliesToRole
		});
		if (result.ok) {
			detailsOpen = false;
			toast.success(m.admin_tcs_updated_toast({ title: result.data.title }));
			await load();
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error(m.admin_tcs_invalid_update(), { title: m.admin_tcs_invalid_title() });
		} else {
			toast.error(errorText(result.error), { title: m.admin_tcs_not_updated_title() });
		}
		detailsBusy = false;
	}

	async function saveDraft() {
		if (draftBusy || !doc || !canSaveDraft) return;
		draftBusy = true;
		const input = {
			description: draftDescription,
			content: draftContent,
			checkboxLabel: draftCheckboxLabel
		};
		const result = serverDraft
			? await updateTcDraft(doc.id, input, editingLocale)
			: await createTcDraft(doc.id, input, editingLocale);
		if (result.ok) {
			toast.success(m.admin_tcs_draft_saved_toast({ version: result.data.version }));
			await load();
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error(m.admin_tcs_draft_fields_required(), {
				title: m.admin_tcs_draft_not_saved_title()
			});
		} else if (result.error.code === 'TC_TEMPLATE_INVALID') {
			toast.error(draftErrorText(result.error), { title: m.agreement_admin_issues_title() });
		} else {
			toast.error(draftErrorText(result.error), { title: m.admin_tcs_draft_not_saved_title() });
		}
		draftBusy = false;
	}

	async function publish() {
		if (publishBusy || !doc) return;
		publishBusy = true;
		const result = await publishTcDraft(doc.id, editingLocale);
		publishConfirmOpen = false;
		if (result.ok) {
			toast.success(m.admin_tcs_published_toast({ version: result.data.version }));
			editorOpen = false;
			await load();
		} else if (result.error.code === 'TC_DRAFT_NOT_FOUND') {
			toast.error(m.admin_tcs_no_draft(), { title: m.admin_tcs_not_published_title() });
		} else {
			toast.error(errorText(result.error), { title: m.admin_tcs_not_published_title() });
		}
		publishBusy = false;
	}
</script>

<svelte:head>
	<title>{m.admin_tcs_doc_page_title({ title: doc?.title ?? m.admin_tcs_heading() })}</title>
</svelte:head>

{#if errorMessage}
	<p
		class="mb-5 flex items-center gap-2.5 rounded-md border border-error/30 bg-error-content px-4
			py-3 text-sm font-medium text-error"
		role="alert"
	>
		<i class="las la-exclamation-circle text-base" aria-hidden="true"></i>
		{errorMessage}
	</p>
{/if}

{#if loading}
	<div class="flex justify-center py-16">
		<span class="loading loading-spinner loading-lg text-primary"></span>
	</div>
{:else if doc}
	<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
				{doc.title}
			</h1>
			<p class="flex flex-wrap items-center gap-2 text-sm text-base-content-muted">
				<a class="font-medium hover:text-base-content" href={resolve('/admin/tcs')}>
					{m.admin_tcs_heading()}
				</a>
				<span class="text-outline" aria-hidden="true">/</span>
				<span class="font-mono text-[12px]">{doc.slug}</span>
				<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
					{tcAudienceLabel(doc.appliesToRole)}
				</span>
				{#if latestPublishedEnglish}
					<span>{m.admin_tcs_currently_at({ version: latestPublishedEnglish.version })}</span>
				{:else}
					<span class="text-warning">{m.admin_tcs_never_published()}</span>
				{/if}
			</p>
		</div>
		<div class="flex gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (detailsOpen = true)}>
				<i class="las la-cog" aria-hidden="true"></i>
				{m.admin_tcs_details()}
			</button>
			{#if !editorOpen}
				<button type="button" class="btn btn-primary" onclick={openNewDraft}>
					<i class="las la-pen" aria-hidden="true"></i>
					{m.admin_tcs_new_draft()}
				</button>
			{/if}
		</div>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<span class="text-[11px] font-semibold tracking-[0.1em] text-neutral uppercase">
			{m.admin_tcs_locale_legend()}
		</span>
		<div class="join" role="group" aria-label={m.admin_tcs_locale_legend()}>
			{#each [{ locale: 'en' as const, label: m.admin_tcs_locale_en() }, { locale: 'fr' as const, label: m.admin_tcs_locale_fr() }] as option (option.locale)}
				<button
					type="button"
					class="btn join-item btn-sm {editingLocale === option.locale ? 'btn-secondary' : 'btn-ghost'}"
					aria-pressed={editingLocale === option.locale}
					onclick={() => switchLocale(option.locale)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
	{#if editingLocale === 'fr'}
		<p class="mb-4 max-w-3xl text-[12.5px] text-base-content-muted">
			{m.admin_tcs_translation_hint()}
		</p>
	{/if}
	{#if isAgreement}
		<p class="mb-4 max-w-3xl text-[12.5px] text-base-content-muted">
			{m.agreement_admin_template_hint()}
		</p>
	{/if}

	{#if editorOpen}
		<section class="mb-8 rounded-xl border border-card-border bg-base-100 p-5">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="font-display text-lg font-bold text-base-content">
					{serverDraft
						? m.admin_tcs_draft_heading({ version: serverDraft.version })
						: m.admin_tcs_new_draft()}
				</h2>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onclick={() => (showPreview = !showPreview)}
					>
						<i class="las {showPreview ? 'la-edit' : 'la-eye'}" aria-hidden="true"></i>
						{showPreview ? m.common_edit() : m.admin_tcs_preview()}
					</button>
					<button
						type="button"
						class="btn btn-sm"
						disabled={draftBusy || !canSaveDraft || !draftDirty}
						onclick={() => void saveDraft()}
					>
						{#if draftBusy}<span class="loading loading-spinner loading-sm"></span>{/if}
						{m.admin_tcs_save_draft()}
					</button>
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={draftBusy || serverDraft === null || draftDirty}
						title={draftDirty && serverDraft !== null ? m.admin_tcs_save_draft_first() : undefined}
						onclick={() => (publishConfirmOpen = true)}
					>
						<i class="las la-paper-plane" aria-hidden="true"></i>
						{m.admin_tcs_publish()}
					</button>
				</div>
			</div>

			<fieldset class="fieldset mb-3">
				<legend class="fieldset-legend">{m.admin_tcs_description_legend()}</legend>
				<input
					type="text"
					class="input w-full"
					maxlength="500"
					placeholder={m.admin_tcs_description_placeholder()}
					bind:value={draftDescription}
				/>
			</fieldset>

			<fieldset class="fieldset mb-3">
				<legend class="fieldset-legend">{m.admin_tcs_checkbox_legend()}</legend>
				<textarea
					class="textarea min-h-20 w-full"
					maxlength="500"
					placeholder={m.admin_tcs_checkbox_placeholder()}
					bind:value={draftCheckboxLabel}
				></textarea>
			</fieldset>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.admin_tcs_content_legend()}</legend>
				{#if showPreview}
					<div class="max-h-[32rem] overflow-y-auto rounded-lg border border-base-300 p-4">
						{#if isAgreement}
							<AgreementTemplatePreview
								documentId={doc.id}
								content={draftContent}
								locale={editingLocale}
							/>
						{:else}
							<MarkdownView content={draftContent} />
						{/if}
					</div>
				{:else}
					<textarea class="textarea min-h-96 w-full font-mono text-xs" bind:value={draftContent}
					></textarea>
				{/if}
				{#if isAgreement}
					<AgreementPlaceholderReference documentId={doc.id} />
				{/if}
			</fieldset>
		</section>
	{/if}

	<h2 class="mb-3 font-display text-lg font-bold text-base-content">
		{m.admin_tcs_version_history()}
	</h2>
	<div class="flex flex-col gap-2">
		{#each doc.versions as version (version.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[70px_150px_1fr_90px] lg:items-center lg:gap-3.5"
			>
				<span class="font-display text-sm font-bold text-base-content"
					>v{version.version}
					<span class="ml-1 text-[10.5px] font-semibold text-outline"
						>{localeOf(version).toUpperCase()}</span
					></span
				>
				<div class="py-1 lg:py-0">
					{#if version.publishedAt}
						<span class="badge badge-sm border-0 bg-success-content font-semibold text-success">
							{m.admin_tcs_published_on({ date: formatDate(version.publishedAt) })}
						</span>
					{:else}
						<span class="badge badge-sm border-0 bg-warning/15 font-semibold text-warning">
							{m.admin_tcs_draft()}
						</span>
					{/if}
				</div>
				<div class="min-w-0 py-1 lg:py-0">
					<p class="truncate text-sm text-base-content">{version.description}</p>
					<p class="truncate text-[11px] text-base-content-muted">☐ {version.checkboxLabel}</p>
				</div>
				<div class="mt-2 flex justify-end lg:mt-0">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (viewing = version)}>
						{m.common_view()}
					</button>
				</div>
			</div>
		{/each}
	</div>

	{#if isAgreement}
		<AgreementSignaturesList />
	{/if}
{/if}

{#if doc}
	<TcDocumentDialog
		open={detailsOpen}
		editing={doc}
		busy={detailsBusy}
		onsave={(details) => void saveDetails(details)}
		oncancel={() => (detailsOpen = false)}
	/>
{/if}

{#if viewing}
	<TcModal
		open
		mode="view"
		title={m.admin_tcs_version_title({ title: doc?.title ?? '', version: viewing.version })}
		content={viewing.content}
		onclose={() => (viewing = null)}
	/>
{/if}

<ConfirmDialog
	open={publishConfirmOpen}
	title={m.admin_tcs_publish_title()}
	body={editingLocale === 'fr'
		? m.admin_tcs_publish_body_translation({ version: serverDraft?.version ?? '' })
		: m.admin_tcs_publish_body({ version: serverDraft?.version ?? '' })}
	confirmLabel={m.admin_tcs_publish()}
	confirmClass="btn-primary"
	busy={publishBusy}
	onconfirm={() => void publish()}
	oncancel={() => (publishConfirmOpen = false)}
/>
