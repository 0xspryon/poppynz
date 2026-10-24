<script lang="ts">
	import ReferralsPanel from '$lib/components/ReferralsPanel.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.provider_referrals_page_title()}</title>
</svelte:head>

<ReferralsPanel />
