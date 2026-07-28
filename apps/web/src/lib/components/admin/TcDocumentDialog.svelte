<script lang="ts">
	/** Create/edit dialog for a terms-and-conditions document's identity (slug,
	 * title, audience). Version content is edited on the document page. */
	import type { AdminTcDocument, TcAppliesToRole, TcDocumentDraft } from '$lib/api/tcs';

	interface Props {
		open: boolean;
		/** The document being edited, or null when creating. */
		editing: AdminTcDocument | null;
		busy?: boolean;
		onsave: (draft: TcDocumentDraft) => void;
		oncancel: () => void;
	}

	let { open, editing, busy = false, onsave, oncancel }: Props = $props();

	const ROLES: Array<{ value: TcAppliesToRole; label: string }> = [
		{ value: 'all', label: 'Everyone' },
		{ value: 'family', label: 'Families' },
		{ value: 'service-provider', label: 'Service providers' }
	];

	let draft: TcDocumentDraft = $state({ slug: '', title: '', appliesToRole: 'all' });

	$effect(() => {
		if (open) {
			draft = editing
				? { slug: editing.slug, title: editing.title, appliesToRole: editing.appliesToRole }
				: { slug: '', title: '', appliesToRole: 'all' };
		}
	});

	const canSave = $derived(
		draft.title.trim().length > 0 && /^[a-z0-9][a-z0-9_-]*$/.test(draft.slug)
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !canSave) return;
		onsave(draft);
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true">
		<form class="modal-box max-w-lg border border-card-border" onsubmit={submit}>
			<h3 class="font-display text-xl font-bold text-base-content">
				{editing ? 'Edit document' : 'New document'}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{editing
					? 'The slug is fixed — acceptances are keyed on it.'
					: 'Create the document, then write and publish its first version.'}
			</p>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">Title · ≤160</legend>
				<input
					type="text"
					class="input w-full"
					maxlength="160"
					required
					placeholder="Privacy Policy"
					bind:value={draft.title}
				/>
			</fieldset>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Slug · lowercase, _ or -</legend>
					<input
						type="text"
						class="input w-full font-mono"
						maxlength="80"
						required
						placeholder="privacy_policy"
						disabled={editing !== null}
						bind:value={draft.slug}
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Applies to</legend>
					<select class="select w-full" bind:value={draft.appliesToRole}>
						{#each ROLES as role (role.value)}
							<option value={role.value}>{role.label}</option>
						{/each}
					</select>
				</fieldset>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !canSave}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{editing ? 'Save changes' : 'Create document'}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label="Close"></button>
	</div>
{/if}
