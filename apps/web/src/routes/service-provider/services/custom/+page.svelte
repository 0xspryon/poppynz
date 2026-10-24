<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { createServiceOffered, listServicesOffered } from '$lib/api/services-offered';
	import { formatNumber } from '$lib/locale';
	import { dollarsToCents, formatMoney, rateRangeLabel } from '$lib/money';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	const RETRY_MESSAGE = m.common_error_generic();
	// Typical market range shown under the rate field.
	const typicalRange = rateRangeLabel(1800, 3000);

	let name = $state('');
	let description = $state('');
	let rate = $state('');
	let saving = $state(false);
	let errorMessage = $state('');
	// Custom services can't go below the platform base rate (UAT #34).
	let baseRateCents = $state<number | null>(null);

	onMount(() => {
		void listServicesOffered().then((result) => {
			if (result.ok) baseRateCents = result.data.customServiceBaseRateCents;
		});
	});

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
			toast.success(m.provider_custom_sent_for_review({ name: name.trim() }), {
				title: m.provider_custom_added_title()
			});
			await goto(resolve('/service-provider/services'));
		} else if (result.error.code === 'INVALID_SERVICE_OFFERED_INPUT') {
			// Server-side form validation stays next to the fields.
			errorMessage = m.provider_custom_invalid_input();
			saving = false;
		} else if (result.error.code === 'SERVICE_RATE_BELOW_FLOOR') {
			errorMessage = m.provider_services_rate_below_floor({
				amount: formatMoney(result.error.floorCents)
			});
			saving = false;
		} else if (result.error.code === 'SERVICES_OFFERED_LIMIT_REACHED') {
			toast.error(m.provider_services_limit({ max: result.error.max }), {
				title: m.provider_custom_not_added_title()
			});
			saving = false;
		} else {
			toast.error(RETRY_MESSAGE, { title: m.provider_custom_not_added_title() });
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{m.provider_custom_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<nav class="mb-4 flex items-center gap-2 text-[12.5px] font-medium text-outline">
		<a href={resolve('/service-provider/services')} class="font-semibold text-primary">
			{m.provider_services_title()}
		</a>
		<i class="las la-angle-right text-xs" aria-hidden="true"></i>
		<span>{m.provider_custom_breadcrumb()}</span>
	</nav>

	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">
		{m.provider_services_add_custom()}
	</h1>
	<p class="mt-1 mb-6 max-w-xl text-sm text-base-content-muted">
		{m.provider_custom_intro()}
	</p>

	<form
		class="max-w-2xl rounded-lg border border-card-border bg-base-100 p-6 lg:p-7"
		onsubmit={save}
	>
		<fieldset class="fieldset">
			<legend class="fieldset-legend">{m.provider_custom_name_legend()}</legend>
			<input
				class="input w-full"
				maxlength="120"
				bind:value={name}
				placeholder={m.provider_custom_name_placeholder()}
			/>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">{m.provider_custom_description_legend()}</legend>
			<textarea
				class="textarea min-h-20 w-full"
				maxlength="1000"
				bind:value={description}
				placeholder={m.provider_custom_description_placeholder()}
			></textarea>
		</fieldset>

		<fieldset class="fieldset mt-3">
			<legend class="fieldset-legend">{m.provider_custom_rate_legend()}</legend>
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
						placeholder={formatNumber(30, { minimumFractionDigits: 2 })}
					/>
				</span>
				<span
					class="rounded-md border-[1.5px] border-base-300 bg-base-200 px-3.5 py-2.5 text-[13px]
						font-semibold text-outline"
				>
					CAD
				</span>
			</div>
			<p class="label text-xs">
				{baseRateCents === null
					? m.provider_custom_rate_hint({ range: typicalRange })
					: m.provider_custom_rate_hint_base({
							amount: formatMoney(baseRateCents),
							range: typicalRange
						})}
			</p>
		</fieldset>

		{#if errorMessage}
			<p role="alert" class="mt-3 text-sm font-medium text-error">{errorMessage}</p>
		{/if}

		<div class="mt-6 flex justify-end gap-2.5">
			<a href={resolve('/service-provider/services')} class="btn btn-ghost">{m.common_cancel()}</a>
			<button type="submit" class="btn btn-primary" disabled={!canSave || saving}>
				{#if saving}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				{m.provider_custom_submit()}
			</button>
		</div>
	</form>
</div>
