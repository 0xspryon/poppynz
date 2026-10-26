<script lang="ts">
	import { formatPlace, withProvince } from '$lib/location';
	import { onMount } from 'svelte';
	import {
		getPlaceSuggestions,
		getProfile,
		updateProfile,
		updateProfileLocation,
		uploadProfilePhoto,
		type PlaceSuggestion,
		type ProviderProfile
	} from '$lib/api/provider-profile';
	import { toast } from '$lib/toast.svelte';
	import { toDateInputValue } from '$lib/date';
	import { SvelteSet } from 'svelte/reactivity';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** Subtitle under the page heading. */
		description: string;
		bioPlaceholder: string;
		/** Helpers need a photo for their profile to count as complete. */
		photoRequired?: boolean;
		/** Whose profile this is — the photo and location copy speak to the
		 * people who will see it (UAT #6). */
		audience?: 'family' | 'helper';
	}

	let { description, bioPlaceholder, photoRequired = false, audience = 'helper' }: Props = $props();

	const photoHint = $derived(
		audience === 'family' ? m.profile_photo_hint_family() : m.profile_photo_hint_helper()
	);
	const requiredPhotoHint = $derived(
		audience === 'family'
			? m.profile_photo_required_hint_family()
			: m.profile_photo_required_hint_helper()
	);
	const locationHint = $derived(
		audience === 'family' ? m.profile_location_hint_family() : m.profile_location_hint_helper()
	);

	const MIN_BIRTH_DATE = '1900-01-01';
	const maxBirthDate = toDateInputValue(new Date());

	// Mirrors the API's public-image limits so a bad pick fails before upload.
	const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

	const RETRY_MESSAGE = m.common_error_generic();

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

	// Profile photo
	let photoInput = $state<HTMLInputElement | null>(null);
	let uploadingPhoto = $state(false);
	let photoError = $state('');

	// Fields the person has typed into since the form appeared. Loaded data
	// never overwrites them, so a late or repeated load can't erase what was
	// typed (UAT #19).
	const dirty = new SvelteSet<string>();

	function fillForm(data: ProviderProfile) {
		if (!dirty.has('firstName')) firstName = data.firstName ?? '';
		if (!dirty.has('lastName')) lastName = data.lastName ?? '';
		if (!dirty.has('gender')) gender = data.gender ?? '';
		if (!dirty.has('phoneNumber')) phoneNumber = data.phoneNumber ?? '';
		if (!dirty.has('dateOfBirth')) dateOfBirth = data.dateOfBirth ?? '';
		if (!dirty.has('shortBio')) shortBio = data.shortBio ?? '';
	}

	function markDirty(event: Event) {
		const name = (event.target as HTMLInputElement | null)?.name;
		if (name) dirty.add(name);
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

	// A typed six-digit year ("198501") used to save (UAT #13).
	const dateOfBirthError = $derived.by(() => {
		const value = dateOfBirth.trim();
		if (value === '') return '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < MIN_BIRTH_DATE || value > maxBirthDate) {
			return m.profile_dob_invalid();
		}
		return '';
	});
	const canSave = $derived(
		firstName.trim().length > 0 && lastName.trim().length > 0 && dateOfBirthError === ''
	);

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
			dirty.clear();
			toast.success(m.profile_saved());
		} else if (result.error.code === 'INVALID_PROFILE_INPUT') {
			// Server-side form validation stays next to the fields.
			saveError = m.profile_invalid_input();
		} else {
			toast.error(RETRY_MESSAGE, { title: m.profile_not_saved_title() });
		}
		saving = false;
	}

	async function onPhotoPicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || uploadingPhoto) return;
		photoError = '';
		if (!PHOTO_TYPES.includes(file.type)) {
			photoError = m.profile_photo_invalid_type();
			return;
		}
		if (file.size > PHOTO_MAX_BYTES) {
			photoError = m.profile_photo_too_large();
			return;
		}
		uploadingPhoto = true;
		const result = await uploadProfilePhoto(file);
		if (result.ok) {
			profile = result.data;
			toast.success(m.profile_photo_saved());
		} else if (result.error.code === 'INVALID_UPLOAD') {
			photoError = m.profile_photo_invalid_upload();
		} else {
			toast.error(RETRY_MESSAGE, { title: m.profile_photo_not_saved_title() });
		}
		uploadingPhoto = false;
	}

	const initials = $derived(
		[profile?.firstName, profile?.lastName]
			.map((part) => part?.trim().charAt(0) ?? '')
			.join('')
			.toUpperCase()
	);

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
			locationError = m.profile_address_search_unavailable();
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
			toast.success(m.profile_location_saved());
		} else {
			toast.error(
				result.error.code === 'GOOGLE_PLACE_INVALID' ? m.profile_location_invalid() : RETRY_MESSAGE,
				{ title: m.profile_location_not_saved_title() }
			);
		}
		savingLocation = false;
	}

	const savedAddress = $derived.by(() => {
		if (!profile) return null;
		// The saved address is Google's formatted one, which already ends in
		// the city, province and country — appending them again showed them
		// twice (UAT #7).
		// UAT round 2 #2: the province is always there, once.
		if (profile.address) return withProvince(profile.address, profile.stateProvince);
		const parts = [formatPlace(profile.city, profile.stateProvince), profile.country].filter(
			Boolean
		);
		return parts.length > 0 ? parts.join(', ') : null;
	});
</script>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.profile_heading()}</h1>
	<p class="mt-1 mb-6 text-sm text-base-content-muted">{description}</p>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else}
		<div
			class="mb-5 flex flex-wrap items-center gap-5 rounded-lg border bg-base-100 p-6 lg:p-7
				{photoRequired && !profile?.image ? 'border-warning-border' : 'border-card-border'}"
		>
			{#if profile?.image}
				<img
					src={profile.image}
					alt={m.profile_photo_alt()}
					class="size-20 shrink-0 rounded-full object-cover"
				/>
			{:else}
				<span
					class="flex size-20 shrink-0 items-center justify-center rounded-full bg-base-300
						font-display text-xl font-bold text-outline"
					aria-hidden="true"
				>
					{#if initials}{initials}{:else}<i class="las la-user text-3xl"></i>{/if}
				</span>
			{/if}
			<div class="min-w-0 flex-1">
				<h2 class="text-base font-bold text-base-content">{m.profile_photo_heading()}</h2>
				<p class="mt-0.5 text-xs text-base-content-muted">
					{photoRequired && !profile?.image ? requiredPhotoHint : photoHint}
					{m.profile_photo_formats()}
				</p>
				{#if photoError}
					<p role="alert" class="mt-2 text-sm font-medium text-error">{photoError}</p>
				{/if}
			</div>
			<input
				bind:this={photoInput}
				type="file"
				accept={PHOTO_TYPES.join(',')}
				class="hidden"
				onchange={(event) => void onPhotoPicked(event)}
			/>
			<button
				type="button"
				class="btn btn-outline btn-sm btn-secondary"
				disabled={uploadingPhoto}
				onclick={() => photoInput?.click()}
			>
				{#if uploadingPhoto}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				{profile?.image ? m.profile_photo_change() : m.profile_photo_upload()}
			</button>
		</div>

		<form
			class="rounded-lg border border-card-border bg-base-100 p-6 lg:p-7"
			onsubmit={save}
			oninput={markDirty}
			onchange={markDirty}
		>
			<div class="grid gap-4 sm:grid-cols-2">
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.profile_first_name()}</legend>
					<input
						class="input w-full"
						name="firstName"
						bind:value={firstName}
						autocomplete="given-name"
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.profile_last_name()}</legend>
					<input
						class="input w-full"
						name="lastName"
						bind:value={lastName}
						autocomplete="family-name"
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.profile_gender()}</legend>
					<select class="select w-full" name="gender" bind:value={gender}>
						<option value="">{m.profile_gender_unspecified()}</option>
						<option value="female">{m.profile_gender_female()}</option>
						<option value="male">{m.profile_gender_male()}</option>
					</select>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.profile_phone()}</legend>
					<input
						class="input w-full"
						name="phoneNumber"
						bind:value={phoneNumber}
						autocomplete="tel"
					/>
				</fieldset>
				<fieldset class="fieldset">
					<legend class="fieldset-legend">{m.profile_dob()}</legend>
					<input
						class="input w-full {dateOfBirthError ? 'input-error' : ''}"
						type="date"
						name="dateOfBirth"
						min={MIN_BIRTH_DATE}
						max={maxBirthDate}
						bind:value={dateOfBirth}
					/>
					{#if dateOfBirthError}
						<p class="label text-xs whitespace-normal text-error">{dateOfBirthError}</p>
					{/if}
				</fieldset>
			</div>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.profile_bio()}</legend>
				<textarea
					class="textarea min-h-24 w-full"
					name="shortBio"
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
					{m.profile_save()}
				</button>
			</div>
		</form>

		<div class="mt-5 rounded-lg border border-card-border bg-base-100 p-6 lg:p-7">
			<h2 class="text-base font-bold text-base-content">{m.profile_location_heading()}</h2>
			<p class="mt-0.5 mb-4 text-xs text-base-content-muted">
				{locationHint}
			</p>

			{#if savedAddress}
				<p class="mb-4 flex items-center gap-2 rounded-md bg-base-300 px-3.5 py-2.5 text-sm">
					<i class="las la-map-marker text-base text-neutral" aria-hidden="true"></i>
					<span class="font-medium text-base-content">{savedAddress}</span>
				</p>
			{:else}
				<p class="mb-4 text-sm font-medium text-warning">{m.profile_location_none()}</p>
			{/if}

			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{savedAddress ? m.profile_location_change() : m.profile_location_set()}
				</legend>
				<input
					class="input w-full"
					placeholder={m.profile_location_placeholder()}
					bind:value={locationQuery}
					oninput={onQueryInput}
				/>
			</fieldset>

			{#if searching || savingLocation}
				<div class="mt-2 flex items-center gap-2 text-xs text-base-content-muted">
					<span class="loading loading-spinner loading-xs text-primary"></span>
					{savingLocation ? m.profile_location_saving() : m.profile_location_searching()}
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
