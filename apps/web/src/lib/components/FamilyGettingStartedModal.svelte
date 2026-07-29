<script lang="ts">
	/** Getting-started checklist shown as a modal when a family lands on the
	 * marketplace with setup steps missing. Completion mirrors the welcome
	 * email and is derived from real data via /me/onboarding/family — never
	 * from "did they click through". Purely presentational; the page decides
	 * when to open it and how dismissal persists. */
	import { resolve } from '$app/paths';
	import type { FamilyOnboardingState } from '$lib/api/onboarding';

	interface Props {
		open: boolean;
		state: FamilyOnboardingState;
		onclose: () => void;
	}

	let { open, state, onclose }: Props = $props();

	const greeting = $derived(state.firstName ? `Welcome, ${state.firstName}!` : 'Welcome to Poppynz!');
	const steps = $derived([
		{
			complete: state.steps.location.complete,
			title: 'Set your home location',
			detail: 'Searches center on it, and vetted helpers nearby can find your family.',
			href: resolve('/family/profile'),
			cta: 'Set location'
		},
		{
			complete: state.steps.needs.complete,
			title: 'Tell us what help you need',
			detail:
				state.steps.needs.count > 0
					? `${state.steps.needs.count} listed so far — add as many as you like.`
					: 'Pick from common services or describe your own.',
			href: resolve('/family/needs'),
			cta: 'List your needs'
		}
	]);
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Getting started">
		<div class="modal-box max-w-lg">
			<h2 class="font-display text-xl font-bold text-base-content">{greeting}</h2>
			<p class="mt-1 mb-4 text-sm text-base-content-muted">
				Two quick steps and you're set — then browse vetted helpers near you.
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
				<li class="flex items-start gap-3 rounded-lg border border-dashed border-primary bg-base-200 p-3.5">
					<span
						class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full
							border-[1.5px] border-outline-variant text-xs font-bold text-base-content-muted"
					>
						3
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold text-base-content">Find the right helper</span>
						<span class="mt-0.5 block text-[12.5px] leading-snug text-base-content-muted">
							Search vetted helpers near you and see their services and rates.
						</span>
					</span>
				</li>
			</ol>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={onclose}>Maybe later</button>
				<button type="button" class="btn btn-primary" onclick={onclose}>Start browsing</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={onclose}></button>
	</div>
{/if}
