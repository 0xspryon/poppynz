<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		createTcDocument,
		listAdminTcs,
		removeTcDocument,
		type AdminTcDocument,
		type TcDocumentDraft
	} from '$lib/api/tcs';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import TcDocumentDialog from '$lib/components/admin/TcDocumentDialog.svelte';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong on our side. Please try again.';

	let items: Array<AdminTcDocument> = $state([]);
	let loading = $state(true);
	let errorMessage: string | null = $state(null);

	// Create modal
	let modalOpen = $state(false);
	let saving = $state(false);

	// Delete confirmation
	let deleting: AdminTcDocument | null = $state(null);
	let deleteBusy = $state(false);

	const errorText = (error: { code: string; message: string }) =>
		error.code === 'FORBIDDEN'
			? 'Your account is not authorized to manage terms and conditions.'
			: error.code === 'UNAUTHORIZED'
				? 'Your session has expired — sign in again.'
				: RETRY_MESSAGE;

	const publishedVersion = (item: AdminTcDocument) =>
		item.versions.find((version) => version.publishedAt !== null) ?? null;
	const hasDraft = (item: AdminTcDocument) =>
		item.versions.some((version) => version.publishedAt === null);

	const AUDIENCE_LABEL: Record<AdminTcDocument['appliesToRole'], string> = {
		all: 'Everyone',
		family: 'Families',
		'service-provider': 'Service providers'
	};

	async function load() {
		loading = true;
		const result = await listAdminTcs();
		if (result.ok) {
			items = result.data;
			errorMessage = null;
		} else {
			errorMessage = errorText(result.error);
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	async function save(draft: TcDocumentDraft) {
		if (saving) return;
		saving = true;
		const result = await createTcDocument(draft);
		if (result.ok) {
			modalOpen = false;
			toast.success(`${result.data.title} created.`);
			await load();
		} else if (result.error.code === 'TC_SLUG_TAKEN') {
			toast.error('A document with this slug already exists. Use a different slug.', {
				title: 'Duplicate slug'
			});
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error('Check the title and slug — lowercase letters, digits, _ and - only.', {
				title: 'Invalid document details'
			});
		} else {
			toast.error(errorText(result.error), { title: 'Document not created' });
		}
		saving = false;
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeTcDocument(deleting.id);
		if (result.ok) {
			toast.success(`${deleting.title} deleted.`);
			deleting = null;
			await load();
		} else {
			toast.error(errorText(result.error), { title: `${deleting.title} not deleted` });
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>Terms &amp; conditions · Poppynz admin</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			Terms &amp; conditions
		</h1>
		<p class="text-sm text-base-content-muted">
			Publishing a new version re-prompts every affected user to accept it.
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={() => (modalOpen = true)}>
		<i class="las la-plus" aria-hidden="true"></i>
		New document
	</button>
</div>

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
{:else if items.length === 0}
	<div class="rounded-xl border border-card-border bg-base-100 p-10 text-center">
		<p class="mb-1 font-semibold text-base-content">No documents yet</p>
		<p class="text-sm text-base-content-muted">
			Create the first document, then write and publish its content.
		</p>
	</div>
{:else}
	<div
		class="mb-2 hidden grid-cols-[1fr_170px_130px_130px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>Document</span><span>Applies to</span><span>Published</span><span>Draft</span>
		<span class="text-right">Actions</span>
	</div>
	<div class="flex flex-col gap-2">
		{#each items as item (item.id)}
			{@const published = publishedVersion(item)}
			<div
				class="rounded-lg border border-card-border bg-base-100 px-4 py-3.5
					lg:grid lg:grid-cols-[1fr_170px_130px_130px_90px] lg:items-center lg:gap-3.5"
			>
				<div class="mb-2 lg:mb-0">
					<a
						class="text-sm font-semibold text-base-content hover:text-primary"
						href="{resolve('/admin/tcs')}/{item.id}"
					>
						{item.title}
					</a>
					<p class="font-mono text-[11px] text-base-content-muted">{item.slug}</p>
				</div>
				<div class="py-1 lg:py-0">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						{AUDIENCE_LABEL[item.appliesToRole]}
					</span>
				</div>
				<div class="py-1 text-xs text-base-content-muted lg:py-0">
					{#if published}
						v{published.version} ·
						{new Date(published.publishedAt ?? '').toLocaleDateString()}
					{:else}
						<span class="text-warning">Never published</span>
					{/if}
				</div>
				<div class="py-1 lg:py-0">
					{#if hasDraft(item)}
						<span class="badge badge-sm border-0 bg-warning/15 font-semibold text-warning">
							Draft in progress
						</span>
					{:else}
						<span class="text-xs text-base-content-muted">—</span>
					{/if}
				</div>
				<div class="mt-2 flex justify-end gap-1.5 lg:mt-0">
					<a
						class="btn btn-ghost btn-sm btn-square"
						aria-label="Open {item.title}"
						href="{resolve('/admin/tcs')}/{item.id}"
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</a>
					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square"
						aria-label="Delete {item.title}"
						onclick={() => (deleting = item)}
					>
						<i class="las la-trash-alt text-base" aria-hidden="true"></i>
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<TcDocumentDialog
	open={modalOpen}
	editing={null}
	busy={saving}
	onsave={(draft) => void save(draft)}
	oncancel={() => (modalOpen = false)}
/>

<ConfirmDialog
	open={deleting !== null}
	title="Delete document"
	body="Delete “{deleting?.title}”? Users will no longer be asked to accept it; recorded acceptances are kept."
	confirmLabel="Delete"
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>
