<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getPlaceSuggestions,
		getProfile,
		updateProfile,
		updateProfileLocation,
		type PlaceSuggestion,
		type ProviderProfile
	} from '$lib/api/provider-profile';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		/** Subtitle under the page heading. */
		description: string;
		bioPlaceholder: string;
	}

	let { description, bioPlaceholder }: Props = $props();

	const RETRY_MESSAGE = 'Something went wrong. Please try again.';

	let profile = $state<ProviderProfile | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');

	// Profile form
	let firstName = $state('');
	let lastName = $state('');
	let gender = $state<'' | 'male' | 'female'>('');
	let phoneNumber = $state('');
	let dateOfBirth = $state('');
	let shortBio = $state('');
	let saving = $state(false);
	let saveError = $state('');

	// Location picker
	let locationQuery = $state('');
	let suggestions = $state<Array<PlaceSuggestion>>([]);
	let searching = $state(false);
	let savingLocation = $state(false);
	let locationError = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	function fillForm(data: ProviderProfile) {
		firstName = data.firstName ?? '';
		lastName = data.lastName ?? '';
		gender = data.gender ?? '';
		phoneNumber = data.phoneNumber ?? '';
		dateOfBirth = data.dateOfBirth ?? '';
		shortBio = data.shortBio ?? '';
	}

	async function load() {
		loading = true;
		errorMessage = '';
		const result = await getProfile();
		if (result.ok) {
			profile = result.data;
			fillForm(result.data);
		} else {
			errorMessage = RETRY_MESSAGE;
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	const canSave = $derived(firstName.trim().length > 0 && lastName.trim().length > 0);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!canSave || saving) return;
		saving = true;
		saveError = '';
		const result = await updateProfile({
			firstName: firstName.trim() || null,
			lastName: lastName.trim() || null,
			gender: gender === '' ? null : gender,
			phoneNumber: phoneNumber.trim() || null,
			dateOfBirth: dateOfBirth.trim() || null,
			shortBio: shortBio.trim() || null
		});
		if (result.ok) {
			profile = result.data;
			toast.success('Profile saved.');
		} else if (result.error.code === 'INVALID_PROFILE_INPUT') {
			// Server-side form validation stays next to the fields.
			saveError = result.error.message;
		} else {
			toast.error(RETRY_MESSAGE, { title: 'Profile not saved' });
		}
		saving = false;
	}

	function onQueryInput() {
		clearTimeout(searchTimer);
		locationError = '';
		const query = locationQuery.trim();
		if (query.length < 3) {
			suggestions = [];
			return;
		}
		searchTimer = setTimeout(() => void search(query), 300);
	}

	async function search(query: string) {
		searching = true;
		const result = await getPlaceSuggestions(query);
		if (result.ok) {
			suggestions = result.data.suggestions;
		} else {
			suggestions = [];
			locationError = 'Address search is unavailable right now.';
		}
		searching = false;
	}

	async function pickSuggestion(suggestion: PlaceSuggestion) {
		if (savingLocation) return;
		savingLocation = true;
		locationError = '';
		const result = await updateProfileLocation(suggestion.placeId);
		if (result.ok) {
			profile = result.data;
			suggestions = [];
			locationQuery = '';
			toast.success('Location saved.');
		} else {
			toast.error(
				result.error.code === 'GOOGLE_PLACE_INVALID' ? result.error.message : RETRY_MESSAGE,
				{ title: 'Location not saved' }
			);
		}
		savingLocation = false;
	}

	const savedAddress = $derived.by(() => {
		if (!profile) return null;
		const parts = [profile.address, profile.city, profile.stateProvince, profile.country].filter(
			Boolean
		);
		return parts.length > 0 ? parts.join(', ') : null;
	});
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">Your profile</h1>
	<p class="mt-1 mb-6 text-sm text-base-content-muted">{description}</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<form class="rounded-lg border border-card-border bg-base-100 p-6 lg:p-7" onsubmit={save}>
			<div class="grid gap-4 sm:grid-cols-2">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">First name</legend>
					<input class="input w-full" bind:value={firstName} autocomplete="given-name" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Last name</legend>
					<input class="input w-full" bind:value={lastName} autocomplete="family-name" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Gender</legend>
					<select class="select w-full" bind:value={gender}>
						<option value="">Prefer not to say</option>
						<option value="female">Female</option>
						<option value="male">Male</option>
					</select>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Phone number</legend>
					<input class="input w-full" bind:value={phoneNumber} autocomplete="tel" />
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Date of birth</legend>
					<input class="input w-full" type="date" bind:value={dateOfBirth} />
				</fieldset>
			</div>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">Short bio</legend>
				<textarea
					class="textarea min-h-24 w-full"
					maxlength="512"
					bind:value={shortBio}
					placeholder={bioPlaceholder}
				></textarea>
				<p class="label text-xs">{shortBio.length} / 512</p>
			</fieldset>

			{#if saveError}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{saveError}</p>
			{/if}

			<div class="mt-5 flex items-center justify-end gap-3">
				<button type="submit" class="btn btn-primary" disabled={!canSave || saving}>
					{#if saving}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Save profile
				</button>
			</div>
		</form>

		<div class="mt-5 rounded-lg border border-card-border bg-base-100 p-6 lg:p-7">
			<h2 class="text-base font-bold text-base-content">Location</h2>
			<p class="mt-0.5 mb-4 text-xs text-base-content-muted">
				Families search by area — only your neighbourhood is shown, never your exact address.
			</p>

			{#if savedAddress}
				<p class="mb-4 flex items-center gap-2 rounded-md bg-base-300 px-3.5 py-2.5 text-sm">
					<i class="las la-map-marker text-base text-neutral" aria-hidden="true"></i>
					<span class="font-medium text-base-content">{savedAddress}</span>
				</p>
			{:else}
				<p class="mb-4 text-sm font-medium text-warning">No location saved yet.</p>
			{/if}

			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{savedAddress ? 'Change location' : 'Set your location'}
				</legend>
				<input
					class="input w-full"
					placeholder="Search your address or neighbourhood…"
					bind:value={locationQuery}
					oninput={onQueryInput}
				/>
			</fieldset>

			{#if searching || savingLocation}
				<div class="mt-2 flex items-center gap-2 text-xs text-base-content-muted">
					<span class="loading loading-spinner loading-xs text-primary"></span>
					{savingLocation ? 'Saving location…' : 'Searching…'}
				</div>
			{:else if suggestions.length > 0}
				<ul class="mt-2 overflow-hidden rounded-md border border-outline-variant bg-base-100">
					{#each suggestions as suggestion (suggestion.placeId)}
						<li class="border-b border-base-300 last:border-b-0">
							<button
								type="button"
								class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm
									transition-colors hover:bg-base-300"
								onclick={() => void pickSuggestion(suggestion)}
							>
								<i class="las la-map-marker text-base text-neutral" aria-hidden="true"></i>
								{suggestion.description}
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if locationError}
				<p role="alert" class="mt-3 text-sm font-medium text-error">{locationError}</p>
			{/if}
		</div>
	{/if}
</div>
