<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		createTcDraft,
		getAdminTc,
		publishTcDraft,
		updateTcDocument,
		updateTcDraft,
		type AdminTcDocument,
		type AdminTcVersion,
		type TcDocumentDraft
	} from '$lib/api/tcs';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import TcDocumentDialog from '$lib/components/admin/TcDocumentDialog.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import TcModal from '$lib/components/TcModal.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

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

	const serverDraft = $derived(
		doc?.versions.find((version) => version.publishedAt === null) ?? null
	);
	const latestPublished = $derived(
		doc?.versions.find((version) => version.publishedAt !== null) ?? null
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

	const AUDIENCE_LABEL: Record<AdminTcDocument['appliesToRole'], string> = {
		all: 'Everyone',
		family: 'Families',
		'service-provider': 'Service providers'
	};

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? 'Your account is not authorized to manage terms and conditions.'
			: error.code === 'UNAUTHORIZED'
				? 'Your session has expired — sign in again.'
				: RETRY_MESSAGE;

	async function load() {
		loading = true;
		const result = await getAdminTc(documentId);
		if (result.ok) {
			doc = result.data;
			errorMessage = null;
			const openDraft = result.data.versions.find((version) => version.publishedAt === null);
			if (openDraft) {
				editorOpen = true;
				draftDescription = openDraft.description;
				draftContent = openDraft.content;
				draftCheckboxLabel = openDraft.checkboxLabel;
			}
		} else {
			errorMessage = errorText(result.error);
		}
		loading = false;
	}

	$effect(() => {
		if (documentId) void load();
	});

	function openNewDraft() {
		// Start from the latest published text so the admin edits, not retypes.
		draftDescription = '';
		draftContent = latestPublished?.content ?? '';
		draftCheckboxLabel = latestPublished?.checkboxLabel ?? '';
		showPreview = false;
		editorOpen = true;
	}

	async function saveDetails(details: TcDocumentDraft) {
		if (detailsBusy || !doc) return;
		detailsBusy = true;
		const result = await updateTcDocument(doc.id, {
			title: details.title,
			appliesToRole: details.appliesToRole
		});
		if (result.ok) {
			detailsOpen = false;
			toast.success(`${result.data.title} updated.`);
			await load();
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error('Check the title — it must be 1–160 characters.', {
				title: 'Invalid document details'
			});
		} else {
			toast.error(errorText(result.error), { title: 'Document not updated' });
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
			? await updateTcDraft(doc.id, input)
			: await createTcDraft(doc.id, input);
		if (result.ok) {
			toast.success(`Draft of v${result.data.version} saved.`);
			await load();
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error('The description, content, and checkbox label are all required.', {
				title: 'Draft not saved'
			});
		} else {
			toast.error(errorText(result.error), { title: 'Draft not saved' });
		}
		draftBusy = false;
	}

	async function publish() {
		if (publishBusy || !doc) return;
		publishBusy = true;
		const result = await publishTcDraft(doc.id);
		publishConfirmOpen = false;
		if (result.ok) {
			toast.success(`Version ${result.data.version} published — users will be asked to accept it.`);
			editorOpen = false;
			await load();
		} else if (result.error.code === 'TC_DRAFT_NOT_FOUND') {
			toast.error('There is no saved draft to publish.', { title: 'Not published' });
		} else {
			toast.error(errorText(result.error), { title: 'Not published' });
		}
		publishBusy = false;
	}
</script>

<svelte:head>
	<title>{doc?.title ?? 'Terms & conditions'} · Poppynz admin</title>
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
					Terms &amp; conditions
				</a>
				<span class="text-outline" aria-hidden="true">/</span>
				<span class="font-mono text-[12px]">{doc.slug}</span>
				<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
					{AUDIENCE_LABEL[doc.appliesToRole]}
				</span>
				{#if latestPublished}
					<span>Currently at v{latestPublished.version}</span>
				{:else}
					<span class="text-warning">Never published</span>
				{/if}
			</p>
		</div>
		<div class="flex gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => (detailsOpen = true)}>
				<i class="las la-cog" aria-hidden="true"></i>
				Details
			</button>
			{#if !editorOpen}
				<button type="button" class="btn btn-primary" onclick={openNewDraft}>
					<i class="las la-pen" aria-hidden="true"></i>
					New draft
				</button>
			{/if}
		</div>
	</div>

	{#if editorOpen}
		<section class="mb-8 rounded-xl border border-card-border bg-base-100 p-5">
			<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
				<h2 class="font-display text-lg font-bold text-base-content">
					{serverDraft ? `Draft — v${serverDraft.version}` : 'New draft'}
				</h2>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onclick={() => (showPreview = !showPreview)}
					>
						<i class="las {showPreview ? 'la-edit' : 'la-eye'}" aria-hidden="true"></i>
						{showPreview ? 'Edit' : 'Preview'}
					</button>
					<button
						type="button"
						class="btn btn-sm"
						disabled={draftBusy || !canSaveDraft || !draftDirty}
						onclick={() => void saveDraft()}
					>
						{#if draftBusy}<span class="loading loading-spinner loading-sm"></span>{/if}
						Save draft
					</button>
					<button
						type="button"
						class="btn btn-primary btn-sm"
						disabled={draftBusy || serverDraft === null || draftDirty}
						title={draftDirty && serverDraft !== null ? 'Save the draft first' : undefined}
						onclick={() => (publishConfirmOpen = true)}
					>
						<i class="las la-paper-plane" aria-hidden="true"></i>
						Publish
					</button>
				</div>
			</div>

			<fieldset class="fieldset mb-3">
				<legend class="fieldset-legend">What changed in this version · ≤500</legend>
				<input
					type="text"
					class="input w-full"
					maxlength="500"
					placeholder="Clarified the cancellation window and updated fee examples"
					bind:value={draftDescription}
				/>
			</fieldset>

			<fieldset class="fieldset mb-3">
				<legend class="fieldset-legend">Mandatory checkbox label · ≤500</legend>
				<textarea
					class="textarea min-h-20 w-full"
					maxlength="500"
					placeholder="I have read and agree to…"
					bind:value={draftCheckboxLabel}
				></textarea>
			</fieldset>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">Content · markdown</legend>
				{#if showPreview}
					<div class="max-h-[32rem] overflow-y-auto rounded-lg border border-base-300 p-4">
						<MarkdownView content={draftContent} />
					</div>
				{:else}
					<textarea class="textarea min-h-96 w-full font-mono text-xs" bind:value={draftContent}
					></textarea>
				{/if}
			</fieldset>
		</section>
	{/if}

	<h2 class="mb-3 font-display text-lg font-bold text-base-content">Version history</h2>
	<div class="flex flex-col gap-2">
		{#each doc.versions as version (version.id)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[70px_150px_1fr_90px] lg:items-center lg:gap-3.5"
			>
				<span class="font-display text-sm font-bold text-base-content">v{version.version}</span>
				<div class="py-1 lg:py-0">
					{#if version.publishedAt}
						<span class="badge badge-sm border-0 bg-success-content font-semibold text-success">
							Published {new Date(version.publishedAt).toLocaleDateString()}
						</span>
					{:else}
						<span class="badge badge-sm border-0 bg-warning/15 font-semibold text-warning">
							Draft
						</span>
					{/if}
				</div>
				<div class="min-w-0 py-1 lg:py-0">
					<p class="truncate text-sm text-base-content">{version.description}</p>
					<p class="truncate text-[11px] text-base-content-muted">☐ {version.checkboxLabel}</p>
				</div>
				<div class="mt-2 flex justify-end lg:mt-0">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => (viewing = version)}>
						View
					</button>
				</div>
			</div>
		{/each}
	</div>
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
		title="{doc?.title} — v{viewing.version}"
		content={viewing.content}
		onclose={() => (viewing = null)}
	/>
{/if}

<ConfirmDialog
	open={publishConfirmOpen}
	title="Publish this version"
	body="Publishing is permanent: the text is frozen as v{serverDraft?.version} and every affected user must accept it on their next visit."
	confirmLabel="Publish"
	confirmClass="btn-primary"
	busy={publishBusy}
	onconfirm={() => void publish()}
	oncancel={() => (publishConfirmOpen = false)}
/>
