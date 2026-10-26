<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		createTcDocument,
		listAdminTcs,
		removeTcDocument,
		tcAudienceLabel,
		type AdminTcDocument,
		type TcDocumentDraft
	} from '$lib/api/tcs';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import TcDocumentDialog from '$lib/components/admin/TcDocumentDialog.svelte';
	import { formatDate } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

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
			? m.admin_tcs_error_forbidden()
			: error.code === 'UNAUTHORIZED'
				? m.admin_tcs_error_session()
				: m.admin_tcs_error_retry();

	const publishedVersion = (item: AdminTcDocument) =>
		item.versions.find((version) => version.publishedAt !== null) ?? null;
	const hasDraft = (item: AdminTcDocument) =>
		item.versions.some((version) => version.publishedAt === null);

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
			toast.success(m.admin_tcs_created_toast({ title: result.data.title }));
			await load();
		} else if (result.error.code === 'TC_SLUG_TAKEN') {
			toast.error(m.admin_tcs_slug_taken(), { title: m.admin_tcs_slug_taken_title() });
		} else if (result.error.code === 'INVALID_TC_INPUT') {
			toast.error(m.admin_tcs_invalid_create(), { title: m.admin_tcs_invalid_title() });
		} else {
			toast.error(errorText(result.error), { title: m.admin_tcs_not_created_title() });
		}
		saving = false;
	}

	async function confirmDelete() {
		if (!deleting || deleteBusy) return;
		deleteBusy = true;
		const result = await removeTcDocument(deleting.id);
		if (result.ok) {
			toast.success(m.admin_tcs_deleted_toast({ title: deleting.title }));
			deleting = null;
			await load();
		} else {
			toast.error(
				result.error.code === 'TC_DOCUMENT_PROTECTED'
					? m.agreement_admin_protected()
					: errorText(result.error),
				{ title: m.admin_tcs_item_not_deleted_title({ title: deleting.title }) }
			);
			deleting = null;
		}
		deleteBusy = false;
	}
</script>

<svelte:head>
	<title>{m.admin_tcs_page_title()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<h1 class="mb-1 font-display text-2xl font-bold text-base-content lg:text-3xl">
			{m.admin_tcs_heading()}
		</h1>
		<p class="text-sm text-base-content-muted">
			{m.admin_tcs_intro()}
		</p>
	</div>
	<button type="button" class="btn btn-primary" onclick={() => (modalOpen = true)}>
		<i class="las la-plus" aria-hidden="true"></i>
		{m.admin_tcs_new()}
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
		<p class="mb-1 font-semibold text-base-content">{m.admin_tcs_empty_title()}</p>
		<p class="text-sm text-base-content-muted">
			{m.admin_tcs_empty_body()}
		</p>
	</div>
{:else}
	<div
		class="mb-2 hidden grid-cols-[1fr_170px_130px_130px_90px] gap-3.5 px-4 text-[10.5px]
			font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
	>
		<span>{m.admin_tcs_col_document()}</span><span>{m.admin_tcs_col_applies_to()}</span>
		<span>{m.admin_tcs_col_published()}</span><span>{m.admin_tcs_col_draft()}</span>
		<span class="text-right">{m.admin_tcs_col_actions()}</span>
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
					{#if item.kind === 'service_agreement'}
						<span class="badge badge-sm mt-1 border-0 bg-primary/10 font-semibold text-primary">
							{m.agreement_admin_badge()}
						</span>
					{/if}
				</div>
				<div class="py-1 lg:py-0">
					<span class="badge badge-sm border-0 bg-base-400 font-semibold text-info">
						{tcAudienceLabel(item.appliesToRole)}
					</span>
				</div>
				<div class="py-1 text-xs text-base-content-muted lg:py-0">
					{#if published}
						{m.admin_tcs_published_meta({
							version: published.version,
							date: formatDate(published.publishedAt ?? '')
						})}
					{:else}
						<span class="text-warning">{m.admin_tcs_never_published()}</span>
					{/if}
				</div>
				<div class="py-1 lg:py-0">
					{#if hasDraft(item)}
						<span class="badge badge-sm border-0 bg-warning/15 font-semibold text-warning">
							{m.admin_tcs_draft_in_progress()}
						</span>
					{:else}
						<span class="text-xs text-base-content-muted">—</span>
					{/if}
				</div>
				<div class="mt-2 flex justify-end gap-1.5 lg:mt-0">
					<a
						class="btn btn-ghost btn-sm btn-square"
						aria-label={m.admin_tcs_open_aria({ title: item.title })}
						href="{resolve('/admin/tcs')}/{item.id}"
					>
						<i class="las la-pen text-base" aria-hidden="true"></i>
					</a>
					{#if item.kind !== 'service_agreement'}
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-square"
							aria-label={m.admin_tcs_delete_aria({ title: item.title })}
							onclick={() => (deleting = item)}
						>
							<i class="las la-trash-alt text-base" aria-hidden="true"></i>
						</button>
					{/if}
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
	title={m.admin_tcs_delete_title()}
	body={m.admin_tcs_delete_body({ title: deleting?.title ?? '' })}
	confirmLabel={m.common_delete()}
	busy={deleteBusy}
	onconfirm={() => void confirmDelete()}
	oncancel={() => (deleting = null)}
/>
