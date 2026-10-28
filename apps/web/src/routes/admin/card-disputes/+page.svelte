<script lang="ts">
	import CardDisputesList from '$lib/components/card-disputes/CardDisputesList.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.admin_card_disputes_page_title()}</title>
</svelte:head>

<CardDisputesList />
