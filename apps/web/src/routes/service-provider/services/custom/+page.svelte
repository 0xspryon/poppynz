<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createServiceOffered } from '$lib/api/services-offered';
	import { dollarsToCents } from '$lib/money';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let name = $state('');
	let description = $state('');
	let rate = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	const canSave = $derived(name.trim().length > 0 && dollarsToCents(rate) !== null);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const cents = dollarsToCents(rate);
		if (!canSave || cents === null || saving) return;
		saving = true;
		errorMessage = '';
		const result = await createServiceOffered({
			name: name.trim(),
			description: description.trim() || null,
			hourlyRateCents: cents,
			catalogueServiceId: null
		});
		if (result.ok) {
			// The toast store is module-level, so this survives the navigation.
			toast.success(`${name.trim()} added to your services.`);
			await goto(resolve('/service-provider/services'));
		} else if (result.error.code === 'INVALID_SERVICE_OFFERED_INPUT') {
			// Server-side form validation stays next to the fields.
			errorMessage = result.error.message;
			saving = false;
		} else if (result.error.code === 'SERVICES_OFFERED_LIMIT_REACHED') {
			toast.error(result.error.message, { title: 'Service not added' });
			saving = false;
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Service not added' });
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Add a custom service · Poppynz</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/service-provider/services')} class="font-semibold text-primary">
			Services & rates
		</a>
		<i class="las la-angle-right text-xs" aria-hidden="true"></i>
		<span>Custom service</span>
	</nav>

	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Add a custom service</h1>
	<p class="mt-1 mb-6 max-w-xl text-sm text-base-content-muted">
		Offer something not on the common list. Describe it in your own words — families see this
		exactly as you write it.
	</p>

	<form
		class="max-w-2xl rounded-lg border border-card-border bg-base-100 p-6 lg:p-7"
		onsubmit={save}
	>
		<fieldset class="fieldset">
			<legend class="fieldset-legend">Service name · ≤120</legend>
			<input
				class="input w-full"
				maxlength="120"
				bind:value={name}
				placeholder="e.g. Newborn overnight support"
			/>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">Description · optional, ≤1000</legend>
			<textarea
				class="textarea min-h-20 w-full"
				maxlength="1000"
				bind:value={description}
				placeholder="What's included, who it's for, any certifications…"
			></textarea>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">Hourly rate</legend>
			<div class="flex items-center gap-2.5">
				<span
					class="flex items-center overflow-hidden rounded-md border-[1.5px] border-outline-variant"
				>
					<span
						class="border-r border-base-300 bg-base-200 px-3 py-2.5 text-[13.5px] font-semibold
							text-base-content-muted"
					>
						$
					</span>
					<input
						class="w-24 px-3.5 py-2.5 text-sm text-base-content outline-none"
						inputmode="decimal"
						bind:value={rate}
						placeholder="30.00"
					/>
				</span>
				<span
					class="rounded-md border-[1.5px] border-base-300 bg-base-200 px-3.5 py-2.5 text-[13px]
						font-semibold text-outline"
				>
					CAD
				</span>
			</div>
			<p class="label text-xs">Most helpers charge $18–$30/hr.</p>
		</fieldset>

		{#if errorMessage}
			<p role="alert" class="mt-3 text-sm font-medium text-error">{errorMessage}</p>
		{/if}

		<div class="mt-6 flex justify-end gap-2.5">
			<a href={resolve('/service-provider/services')} class="btn btn-ghost">Cancel</a>
			<button type="submit" class="btn btn-primary" disabled={!canSave || saving}>
				{#if saving}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				Add service
			</button>
		</div>
	</form>
</div>
