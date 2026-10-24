<script lang="ts">
	/** In force / Scheduled / Ended — where an effective-dated row stands today. */
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		standing: 'in_force' | 'scheduled' | 'ended';
	}

	let { standing }: Props = $props();
</script>

{#if standing === 'in_force'}
	<StatusChip status="active" label={m.tax_standing_in_force()} />
{:else if standing === 'scheduled'}
	<StatusChip status="proposed" label={m.tax_standing_scheduled()} />
{:else}
	<StatusChip status="ended" label={m.tax_standing_ended()} />
{/if}
