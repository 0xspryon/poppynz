<script lang="ts">
	/** The service agreement editor's preview (UAT round 2, item 4): the
	 * draft filled with sample contract data by the API, or the problems
	 * that would stop it saving. */
	import { previewAgreementTemplate, type AgreementTemplatePreview } from '$lib/api/agreements';
	import type { TcLocale } from '$lib/api/tcs';
	import { agreementIssueText } from '$lib/agreement-errors';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';

	let { documentId, content, locale }: { documentId: string; content: string; locale: TcLocale } =
		$props();

	let preview = $state<AgreementTemplatePreview | null>(null);
	let loading = $state(true);

	let seq = 0;
	$effect(() => {
		seq += 1;
		const current = seq;
		loading = true;
		void previewAgreementTemplate(documentId, content, locale).then((result) => {
			if (current !== seq) return;
			loading = false;
			if (result.ok) {
				preview = result.data;
			} else {
				preview = null;
				toast.error(m.agreement_admin_preview_failed());
			}
		});
	});
</script>

<p class="mb-2 text-[11px] font-semibold tracking-[0.08em] text-outline uppercase">
	{m.agreement_admin_preview_sample()}
</p>
{#if loading}
	<div class="flex justify-center py-10">
		<span class="loading loading-spinner loading-md text-primary"></span>
	</div>
{:else if preview && preview.issues.length > 0}
	<div
		class="rounded-md border border-error/30 bg-error-content px-4 py-3 text-sm text-error"
		role="alert"
	>
		<p class="font-semibold">{m.agreement_admin_issues_title()}</p>
		<ul class="mt-1 list-disc pl-5">
			{#each preview.issues as issue, index (index)}
				<li>{agreementIssueText(issue)}</li>
			{/each}
		</ul>
	</div>
{:else if preview?.content != null}
	<div lang={locale}>
		<MarkdownView content={preview.content} />
	</div>
{/if}
