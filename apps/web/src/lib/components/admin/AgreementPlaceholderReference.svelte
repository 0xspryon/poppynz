<script lang="ts">
	/** The placeholder reference beside the service agreement editor (UAT
	 * round 2, item 4): the syntax, and every name a template may use — the
	 * list comes from the API, so it can never drift from what saving checks. */
	import { previewAgreementTemplate, type AgreementPlaceholder } from '$lib/api/agreements';
	import { m } from '$lib/paraglide/messages';

	let { documentId }: { documentId: string } = $props();

	let placeholders = $state<Array<AgreementPlaceholder>>([]);

	$effect(() => {
		void previewAgreementTemplate(documentId, '', 'en').then((result) => {
			if (result.ok) placeholders = result.data.placeholders;
		});
	});

	const tag = (placeholder: AgreementPlaceholder) =>
		placeholder.kind === 'text'
			? `{{${placeholder.name}}}`
			: `{{#${placeholder.name}}}…{{/${placeholder.name}}}`;
</script>

<details class="mt-3 rounded-lg border border-base-300 bg-base-200 px-4 py-3">
	<summary class="cursor-pointer text-sm font-semibold text-base-content">
		{m.agreement_admin_placeholders_heading()}
	</summary>
	<ul class="mt-2 space-y-1 text-[12.5px] text-base-content">
		<li><code class="font-mono">{'{{family.name}}'}</code> — {m.agreement_admin_syntax_value()}</li>
		<li>
			<code class="font-mono">{'{{#services}} … {{/services}}'}</code> — {m.agreement_admin_syntax_section()}
		</li>
		<li>
			<code class="font-mono">{'{{^contract.hasEndDate}} … {{/contract.hasEndDate}}'}</code> — {m.agreement_admin_syntax_inverted()}
		</li>
	</ul>
	<p class="mt-2 text-[12px] text-base-content-muted">{m.agreement_admin_placeholders_hint()}</p>
	<ul class="mt-2 grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
		{#each placeholders as placeholder (`${placeholder.within}:${placeholder.name}`)}
			<li class="min-w-0 truncate {placeholder.within ? 'pl-4' : ''}">
				<code class="font-mono text-base-content">{tag(placeholder)}</code>
				<span class="text-base-content-muted">
					{#if placeholder.kind === 'list'}· {m.agreement_admin_kind_list()}{/if}
					{#if placeholder.kind === 'flag'}· {m.agreement_admin_kind_flag()}{/if}
					{#if placeholder.within}· {m.agreement_admin_within({ list: placeholder.within })}{/if}
				</span>
			</li>
		{/each}
	</ul>
</details>
