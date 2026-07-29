<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createServiceNeeded } from '$lib/api/services-needed';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

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
			toast.success(`${name.trim()} added to your needs.`);
			await goto(resolve('/family/needs'));
		} else if (result.error.code === 'INVALID_SERVICE_NEEDED_INPUT') {
			// Server-side form validation stays next to the fields.
			errorMessage = result.error.message;
			saving = false;
		} else if (result.error.code === 'SERVICES_NEEDED_LIMIT_REACHED') {
			toast.error(result.error.message, { title: 'Service not added' });
			saving = false;
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Service not added' });
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Add a service you need · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/family/needs')} class="font-semibold text-primary">
			Services I need
		</a>
		<i class="las la-angle-right text-xs" aria-hidden="true"></i>
		<span>Something else</span>
	</nav>

	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Add something else</h1>
	<p class="mt-1 mb-6 max-w-xl text-sm text-base-content-muted">
		Looking for help that isn't on the common list? Describe it in your own words — helpers see
		this exactly as you write it.
	</p>

	<form
		class="max-w-2xl rounded-lg border border-card-border bg-base-100 p-6 lg:p-7"
		onsubmit={save}
	>
		<fieldset class="fieldset">
			<legend class="fieldset-legend">What do you need? · ≤120</legend>
			<input
				class="input w-full"
				maxlength="120"
				bind:value={name}
				placeholder="e.g. After-school pickup and homework help"
			/>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">Details · optional, ≤1000</legend>
			<textarea
				class="textarea min-h-20 w-full"
				maxlength="1000"
				bind:value={description}
				placeholder="Days and times, ages of your children, anything a helper should know…"
			></textarea>
		</fieldset>

		{#if errorMessage}
			<p role="alert" class="mt-3 text-sm font-medium text-error">{errorMessage}</p>
		{/if}

		<div class="mt-6 flex justify-end gap-2.5">
			<a href={resolve('/family/needs')} class="btn btn-ghost">Cancel</a>
			<button type="submit" class="btn btn-primary" disabled={!canSave || saving}>
				{#if saving}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				Add to my needs
			</button>
		</div>
	</form>
</div>
