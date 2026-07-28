<script lang="ts">
	/** Renders trusted-ish markdown (admin-authored T&C content) as sanitized
	 * HTML — the only {@html} sink in the app, always behind DOMPurify. */
	import { browser } from '$app/environment';
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';

	let { content }: { content: string } = $props();

	// DOMPurify needs a DOM; content is fetched client-side anyway.
	const html = $derived(
		browser && content ? DOMPurify.sanitize(marked.parse(content, { async: false })) : ''
	);
</script>

<div class="markdown-view text-sm leading-relaxed text-base-content">
	<!-- eslint-disable-next-line svelte/no-at-html-tags — sanitized above -->
	{@html html}
</div>

<style>
	.markdown-view :global(h1) {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 1.5rem 0 0.5rem;
	}

	.markdown-view :global(h2) {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 1.25rem 0 0.5rem;
	}

	.markdown-view :global(h3) {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 1rem 0 0.375rem;
	}

	.markdown-view :global(p) {
		margin: 0.5rem 0;
	}

	.markdown-view :global(ul),
	.markdown-view :global(ol) {
		margin: 0.5rem 0;
		padding-inline-start: 1.25rem;
	}

	.markdown-view :global(ul) {
		list-style: disc;
	}

	.markdown-view :global(ol) {
		list-style: decimal;
	}

	.markdown-view :global(li) {
		margin: 0.25rem 0;
	}

	.markdown-view :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
	}

	.markdown-view :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-base-300);
		margin: 1rem 0;
	}

	.markdown-view :global(blockquote) {
		border-inline-start: 3px solid var(--color-base-300);
		padding-inline-start: 0.75rem;
		margin: 0.75rem 0;
	}

	.markdown-view :global(table) {
		border-collapse: collapse;
		margin: 0.75rem 0;
	}

	.markdown-view :global(th),
	.markdown-view :global(td) {
		border: 1px solid var(--color-base-300);
		padding: 0.375rem 0.625rem;
		text-align: left;
	}
</style>
