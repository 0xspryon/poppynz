<script lang="ts">
	interface Props {
		/** 'dark' renders for navy backgrounds, 'light' for light surfaces. */
		tone?: 'dark' | 'light';
	}

	let { tone = 'light' }: Props = $props();
</script>

<span
	class="inline-flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight
		{tone === 'dark' ? 'text-secondary-content' : 'text-secondary'}"
>
	<span class="flex size-7 items-center justify-center rounded-md bg-primary">
		<i class="las la-home text-base text-primary-content" aria-hidden="true"></i>
	</span>
	poppynz
</span>
