<script lang="ts">
	/** In force / Scheduled / Ended — where an effective-dated row stands today. */
	import StatusChip from '$lib/components/StatusChip.svelte';

	interface Props {
		standing: 'in_force' | 'scheduled' | 'ended';
	}

	let { standing }: Props = $props();
</script>

{#if standing === 'in_force'}
	<StatusChip status="active" label="In force" />
{:else if standing === 'scheduled'}
	<StatusChip status="proposed" label="Scheduled" />
{:else}
	<StatusChip status="ended" label="Ended" />
{/if}
