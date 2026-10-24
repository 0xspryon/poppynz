<script lang="ts">
	import ProfileSettings from '$lib/components/ProfileSettings.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.provider_profile_page_title()}</title>
</svelte:head>

<ProfileSettings
	description={m.provider_profile_description()}
	photoRequired
	bioPlaceholder={m.provider_profile_bio_placeholder()}
/>
