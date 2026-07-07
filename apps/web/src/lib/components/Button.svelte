<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/**
		 * primary — sky pill CTA (one per screen);
		 * secondary — navy outline;
		 * muted — quiet outline pill (e.g. disabled resend).
		 */
		variant?: 'primary' | 'secondary' | 'muted';
		block?: boolean;
		loading?: boolean;
		children: Snippet;
	}

	let {
		variant = 'primary',
		block = false,
		loading = false,
		disabled,
		children,
		...rest
	}: Props = $props();

	const variantClasses = {
		primary:
			'rounded-pill bg-primary px-6 py-4 text-base text-primary-content shadow-primary hover:brightness-105 disabled:opacity-60 disabled:shadow-none',
		secondary:
			'rounded-md border-2 border-secondary bg-base-100 px-5 py-2 text-sm text-secondary hover:bg-base-300',
		muted: 'rounded-pill border-2 border-outline-variant bg-base-100 px-6 py-3 text-sm text-outline'
	};
</script>

<button
	{...rest}
	disabled={disabled || loading}
	class="inline-flex cursor-pointer items-center justify-center gap-2.5 font-sans font-semibold
		transition disabled:cursor-not-allowed
		{variantClasses[variant]} {block ? 'w-full' : ''}"
>
	{#if loading}
		<i class="las la-circle-notch animate-spin text-lg" aria-hidden="true"></i>
	{/if}
	{@render children()}
</button>
