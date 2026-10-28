<script lang="ts">
	import FailedRefundsQueue from '$lib/components/admin/FailedRefundsQueue.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.admin_money_refunds_page_title()}</title>
</svelte:head>

<FailedRefundsQueue />
