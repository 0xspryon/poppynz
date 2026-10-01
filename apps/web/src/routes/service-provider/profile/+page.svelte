<script lang="ts">
	import ProfileSettings from '$lib/components/ProfileSettings.svelte';
</script>

<svelte:head>
	<title>Profile · Poppynz</title>
</svelte:head>

<ProfileSettings
	description="Your photo, contact details, location & bio — families see this first."
	photoRequired
	bioPlaceholder="Tell families about your experience and what you love helping with."
/>
