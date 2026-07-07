<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		checked: boolean;
		id?: string;
		children: Snippet;
	}

	let { checked = $bindable(false), id = 'checkbox', children }: Props = $props();
</script>

<label for={id} class="flex cursor-pointer items-start gap-2.5">
	<input {id} type="checkbox" bind:checked class="peer sr-only" />
	<span
		class="mt-0.5 flex size-5 flex-none items-center justify-center rounded-xs border-2 transition
			peer-focus-visible:shadow-focus-ring
			{checked ? 'border-primary bg-primary' : 'border-outline-variant bg-base-100'}"
		aria-hidden="true"
	>
		{#if checked}
			<i class="las la-check text-xs text-primary-content"></i>
		{/if}
	</span>
	<span class="text-sm leading-normal text-base-content-muted">
		{@render children()}
	</span>
</label>
