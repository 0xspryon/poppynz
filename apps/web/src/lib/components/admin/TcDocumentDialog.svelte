<script lang="ts">
	/** Create/edit dialog for a terms-and-conditions document's identity (slug,
	 * title, audience). Version content is edited on the document page. */
	import {
		tcAudienceLabel,
		type AdminTcDocument,
		type TcAppliesToRole,
		type TcDocumentDraft
	} from '$lib/api/tcs';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		/** The document being edited, or null when creating. */
		editing: AdminTcDocument | null;
		busy?: boolean;
		onsave: (draft: TcDocumentDraft) => void;
		oncancel: () => void;
	}

	let { open, editing, busy = false, onsave, oncancel }: Props = $props();

	const ROLES: Array<TcAppliesToRole> = ['all', 'family', 'service-provider'];

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
				{editing ? m.admin_tcs_edit_title() : m.admin_tcs_new()}
			</h3>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{editing ? m.admin_tcs_edit_intro() : m.admin_tcs_new_intro()}
			</p>

			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.admin_tcs_title_legend()}</legend>
				<input
					type="text"
					class="input w-full"
					maxlength="160"
					required
					placeholder={m.admin_tcs_title_placeholder()}
					bind:value={draft.title}
				/>
			</fieldset>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.admin_tcs_slug_legend()}</legend>
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
					<legend class="fieldset-legend">{m.admin_tcs_col_applies_to()}</legend>
					<select class="select w-full" bind:value={draft.appliesToRole}>
						{#each ROLES as role (role)}
							<option value={role}>{tcAudienceLabel(role)}</option>
						{/each}
					</select>
				</fieldset>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={busy || !canSave}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{editing ? m.admin_tcs_save_changes() : m.admin_tcs_create()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" onclick={oncancel} aria-label={m.common_close()}
		></button>
	</div>
{/if}
