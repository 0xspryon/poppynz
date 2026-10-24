<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createServiceNeeded } from '$lib/api/services-needed';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = m.family_needs_retry();

	let name = $state('');
	let description = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	const canSave = $derived(name.trim().length > 0);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!canSave || saving) return;
		saving = true;
		errorMessage = '';
		const result = await createServiceNeeded({
			name: name.trim(),
			description: description.trim() || null,
			catalogueServiceId: null
		});
		if (result.ok) {
			// The toast store is module-level, so this survives the navigation.
			toast.success(m.family_needs_added({ name: name.trim() }));
			await goto(resolve('/family/needs'));
		} else if (result.error.code === 'INVALID_SERVICE_NEEDED_INPUT') {
			// Server-side form validation stays next to the fields.
			errorMessage = m.family_needs_custom_invalid();
			saving = false;
		} else if (result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED') {
			toast.error(m.family_needs_limit({ max: result.error.max }), {
				title: m.family_needs_custom_not_added_title()
			});
			saving = false;
		} else {
			toast.error(RETRY_MESSAGE, { title: m.family_needs_custom_not_added_title() });
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{m.family_needs_custom_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/family/needs')} class="font-semibold text-primary">
			{m.family_needs_title()}
		</a>
		<i class="las la-angle-right text-xs" aria-hidden="true"></i>
		<span>{m.family_needs_custom_breadcrumb()}</span>
	</nav>

	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
		{m.family_needs_add_something_else()}
	</h1>
	<p class="mt-1 mb-6 max-w-xl text-sm text-base-content-muted">
		{m.family_needs_custom_subtitle()}
	</p>

	<form
		class="max-w-2xl rounded-lg border border-card-border bg-base-100 p-6 lg:p-7"
		onsubmit={save}
	>
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.family_needs_custom_name_label()}</legend>
			<input
				class="input w-full"
				maxlength="120"
				bind:value={name}
				placeholder={m.family_needs_custom_name_placeholder()}
			/>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">{m.family_needs_custom_details_label()}</legend>
			<textarea
				class="textarea min-h-20 w-full"
				maxlength="1000"
				bind:value={description}
				placeholder={m.family_needs_custom_details_placeholder()}
			></textarea>
		</fieldset>

		{#if errorMessage}
			<p role="alert" class="mt-3 text-sm font-medium text-error">{errorMessage}</p>
		{/if}

		<div class="mt-6 flex justify-end gap-2.5">
			<a href={resolve('/family/needs')} class="btn btn-ghost">{m.common_cancel()}</a>
			<button type="submit" class="btn btn-primary" disabled={!canSave || saving}>
				{#if saving}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				{m.family_needs_custom_submit()}
			</button>
		</div>
	</form>
</div>
