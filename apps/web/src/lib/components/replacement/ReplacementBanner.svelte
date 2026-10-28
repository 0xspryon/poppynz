<script lang="ts">
	/** Find a replacement (Tier 3, step 1b): what is being replaced — whose
	 * cancelled sessions, for which service and when — and how the template
	 * works. Shown on Find help and on a helper's profile in replacement
	 * mode; `actions` adds the page's own buttons. */
	import type { Snippet } from 'svelte';
	import type { ReplacementContext } from '$lib/api/contracts';
	import { m } from '$lib/paraglide/messages';
	import { replacementSessionLabel } from '$lib/replacement';

	interface Props {
		context: ReplacementContext;
		/** Say that the helper who cancelled is left out of the results. */
		showHidden?: boolean;
		actions?: Snippet;
	}

	let { context, showHidden = false, actions }: Props = $props();

	const service = $derived(context.sessions[0]?.serviceName ?? '');
</script>

<section
	class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-base-100 px-4 py-3"
	aria-labelledby="replacement-banner-title"
	data-testid="replacement-banner"
>
	<div class="flex items-start gap-2.5">
		<i class="las la-user-friends mt-0.5 shrink-0 text-lg text-accent" aria-hidden="true"></i>
		<div class="min-w-0 flex-1">
			<h2 id="replacement-banner-title" class="text-[13.5px] font-bold text-base-content">
				{m.replacement_banner_title({ name: context.helper.name })}
			</h2>
			<p class="mt-0.5 text-[12.5px] leading-relaxed text-base-content-muted">
				{m.replacement_banner_body({ service })}
				{#if showHidden}
					{m.replacement_find_hidden({ name: context.helper.name })}
				{/if}
			</p>
			{#if context.sessions.length > 0}
				<p class="sr-only">{m.replacement_banner_sessions()}</p>
				<ul class="mt-1.5 flex flex-wrap gap-1.5">
					{#each context.sessions as session (session.id)}
						<li
							class="rounded-pill bg-base-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-secondary"
						>
							{replacementSessionLabel(session)}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="flex flex-wrap items-center gap-2 pl-7">
			{@render actions()}
		</div>
	{/if}
</section>
