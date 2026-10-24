<script lang="ts">
	import ProfileSettings from '$lib/components/ProfileSettings.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.family_profile_page_title()}</title>
</svelte:head>

<ProfileSettings
	audience="family"
	description={m.family_profile_description()}
	bioPlaceholder={m.family_profile_bio_placeholder()}
/>
