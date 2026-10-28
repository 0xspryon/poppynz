<script lang="ts">
	import ContractCyclePage from '$lib/components/contracts/ContractCyclePage.svelte';
	import SessionActions from '$lib/components/sessions/SessionActions.svelte';
</script>

<ContractCyclePage role="family">
	{#snippet sessionActions(session, cycle, refresh)}
		<SessionActions {session} {cycle} onchanged={refresh} />
	{/snippet}
</ContractCyclePage>
