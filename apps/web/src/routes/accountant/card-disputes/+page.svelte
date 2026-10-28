<script lang="ts">
	/** The accountant reads the card disputes and what Poppynz bears for them
	 * (permission `cardDispute: read, finance`); admins answer them. */
	import CardDisputesList from '$lib/components/card-disputes/CardDisputesList.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.admin_card_disputes_page_title()}</title>
</svelte:head>

<CardDisputesList readonly />
