<script lang="ts">
	interface Props {
		/** 'dark' renders for navy backgrounds, 'light' for light surfaces. */
		tone?: 'dark' | 'light';
	}

	let { tone = 'light' }: Props = $props();

	// Visual-only for now — real i18n wiring comes with the API integration.
	let lang: 'en' | 'es' = $state('en');

	const options = ['en', 'es'] as const;
</script>

<span
	class="flex gap-0.5 rounded-md p-0.5 text-xs font-semibold
		{tone === 'dark'
			? 'border border-secondary-content/30'
			: 'border border-outline-variant bg-base-100'}"
	role="group"
	aria-label="Language"
>
	{#each options as option (option)}
		<button
			type="button"
			class="cursor-pointer rounded-sm px-2.5 py-1 uppercase transition-colors
				{lang === option
				? tone === 'dark'
					? 'bg-base-100 text-secondary'
					: 'bg-secondary text-secondary-content'
				: tone === 'dark'
					? 'text-secondary-content-muted'
					: 'text-base-content-muted'}"
			aria-pressed={lang === option}
			onclick={() => (lang = option)}
		>
			{option}
		</button>
	{/each}
</span>
