<script lang="ts">
	import { getLocale, locales, type Locale } from '$lib/locale';
	import { switchLocale } from '$lib/locale-sync';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** 'dark' renders for navy backgrounds, 'light' for light surfaces. */
		tone?: 'dark' | 'light';
	}

	let { tone = 'light' }: Props = $props();

	// The page reloads in the new locale, so the active one never changes
	// while this component is mounted.
	const current = getLocale();
	let switching = $state(false);

	const languageName = (locale: Locale) =>
		locale === 'fr' ? m.lang_name_fr() : m.lang_name_en();

	async function choose(locale: Locale) {
		if (locale === current || switching) return;
		switching = true;
		try {
			await switchLocale(locale);
		} finally {
			switching = false;
		}
	}
</script>

<span
	class="flex gap-0.5 rounded-md p-0.5 text-xs font-semibold
		{tone === 'dark'
		? 'border border-secondary-content/30'
		: 'border border-outline-variant bg-base-100'}"
	role="group"
	aria-label={m.lang_toggle_label()}
>
	{#each locales as option (option)}
		<button
			type="button"
			lang={option}
			class="cursor-pointer rounded-sm px-2.5 py-1 uppercase transition-colors
				{current === option
				? tone === 'dark'
					? 'bg-base-100 text-secondary'
					: 'bg-secondary text-secondary-content'
				: tone === 'dark'
					? 'text-secondary-content-muted'
					: 'text-base-content-muted'}"
			aria-pressed={current === option}
			aria-label={languageName(option)}
			disabled={switching}
			onclick={() => choose(option)}
		>
			{option}
		</button>
	{/each}
</span>
