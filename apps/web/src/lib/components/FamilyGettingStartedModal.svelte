<script lang="ts">
	/** Getting-started checklist shown as a modal when a family lands on the
	 * marketplace with setup steps missing. Completion mirrors the welcome
	 * email and is derived from real data via /me/onboarding/family — never
	 * from "did they click through". Purely presentational; the page decides
	 * when to open it and how dismissal persists. */
	import { resolve } from '$app/paths';
	import type { FamilyOnboardingState } from '$lib/api/onboarding';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		state: FamilyOnboardingState;
		onclose: () => void;
	}

	let { open, state, onclose }: Props = $props();

	const approved = $derived(state.approval !== null);
	const greeting = $derived(
		state.firstName ? m.onboarding_welcome_name({ name: state.firstName }) : m.onboarding_welcome()
	);
	const steps = $derived([
		{
			complete: state.steps.location.complete,
			title: m.onboarding_step_location_title(),
			detail: m.onboarding_step_location_detail(),
			href: resolve('/family/profile'),
			cta: m.onboarding_step_location_cta()
		},
		{
			complete: state.steps.needs.complete,
			title: m.onboarding_step_needs_title(),
			detail:
				state.steps.needs.count > 0
					? m.onboarding_step_needs_count({ count: state.steps.needs.count })
					: m.onboarding_step_needs_empty(),
			href: resolve('/family/needs'),
			cta: m.onboarding_step_needs_cta()
		},
		{
			complete: state.steps.documents.complete,
			title: m.onboarding_step_check_title(),
			detail:
				state.safetyVerification.status === 'review_required'
					? m.onboarding_step_check_review()
					: state.safetyVerification.verified
						? m.onboarding_step_check_verified()
						: m.onboarding_step_check_todo(),
			href: resolve('/family/documents'),
			cta: m.onboarding_step_check_cta()
		}
	]);
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={m.onboarding_dialog_label()}>
		<div class="modal-box max-w-lg">
			<h2 class="font-display text-xl font-bold text-base-content">{greeting}</h2>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				{m.onboarding_intro()}
			</p>

			<ol class="flex flex-col gap-2.5">
				{#each steps as step, index (step.title)}
					<li
						class="flex items-start gap-3 rounded-lg border p-3.5
							{step.complete ? 'border-card-border bg-base-200' : 'border-card-border bg-base-100'}"
					>
						<span
							class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs
								font-bold
								{step.complete
								? 'bg-success text-primary-content'
								: 'border-[1.5px] border-outline-variant text-base-content-muted'}"
						>
							{#if step.complete}
								<i class="las la-check" aria-hidden="true"></i>
							{:else}
								{index + 1}
							{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span
								class="block text-sm font-semibold
									{step.complete ? 'text-base-content-muted line-through' : 'text-base-content'}"
							>
								{step.title}
							</span>
							<span class="mt-0.5 block text-[12.5px] leading-snug text-base-content-muted">
								{step.detail}
							</span>
						</span>
						{#if !step.complete}
							<a href={step.href} class="btn shrink-0 self-center btn-outline btn-sm btn-secondary">
								{step.cta}
							</a>
						{/if}
					</li>
				{/each}
				<li
					class="flex items-start gap-3 rounded-lg border border-dashed border-primary bg-base-200 p-3.5"
				>
					<span
						class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full
							border-[1.5px] border-outline-variant text-xs font-bold text-base-content-muted"
					>
						4
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold text-base-content">
							{m.onboarding_step_find_title()}
						</span
						>
						<span class="mt-0.5 block text-[12.5px] leading-snug text-base-content-muted">
							{approved
								? m.onboarding_step_find_approved()
								: m.onboarding_step_find_locked()}
						</span>
					</span>
				</li>
			</ol>

			<div class="modal-action">
				{#if approved}
					<button type="button" class="btn btn-ghost" onclick={onclose}>{m.onboarding_maybe_later()}</button>
					<button type="button" class="btn btn-primary" onclick={onclose}>{m.onboarding_start_browsing()}</button
					>
				{:else}
					<button type="button" class="btn btn-primary" onclick={onclose}>{m.onboarding_got_it()}</button>
				{/if}
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={onclose}></button>
	</div>
{/if}
