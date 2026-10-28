<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import HelperTransfers from '$lib/components/payouts/HelperTransfers.svelte';
	import PayoutsPage from '$lib/components/payouts/PayoutsPage.svelte';
	import { m } from '$lib/paraglide/messages';

	// Stripe returns helpers here: ?from=stripe after onboarding, ?refresh=1
	// when the onboarding link expired. Read once on arrival.
	const returnState: 'stripe' | 'refresh' | null =
		page.url.searchParams.get('from') === 'stripe'
			? 'stripe'
			: page.url.searchParams.get('refresh') === '1'
				? 'refresh'
				: null;

	function dropQuery() {
		void goto(resolve('/service-provider/payouts'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<svelte:head>
	<title>{m.payouts_page_title()}</title>
</svelte:head>

<PayoutsPage {returnState} onreturnhandled={dropQuery} />
<!-- Tier 3 step 2: what was (or will be) sent, per cycle. -->
<div class="mx-auto max-w-3xl">
	<HelperTransfers />
</div>
