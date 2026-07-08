<script lang="ts">
	import type { Role } from '$lib/api/auth';

	interface Props {
		value: Role;
	}

	let { value = $bindable('family') }: Props = $props();

	const options: Array<{ role: Role; icon: string; title: string; blurb: string }> = [
		{ role: 'family', icon: 'la-home', title: 'A family', blurb: 'Looking for trusted care' },
		{
			role: 'service-provider',
			icon: 'la-heart',
			title: 'A caregiver',
			blurb: 'I offer in-home care'
		}
	];
</script>

<div role="radiogroup" aria-label="I'm joining as" class="grid gap-3 sm:grid-cols-2 sm:gap-4">
	{#each options as option (option.role)}
		{@const selected = value === option.role}
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			onclick={() => (value = option.role)}
			class="relative cursor-pointer rounded-lg border-2 p-4 text-left transition sm:p-5
				{selected
				? 'border-primary bg-base-400 shadow-focus-ring'
				: 'border-outline-variant bg-base-100 hover:border-outline'}"
		>
			<span
				class="absolute top-4 right-4 flex size-5 items-center justify-center rounded-pill
					{selected ? 'bg-primary' : 'border-2 border-outline-variant'}"
			>
				{#if selected}
					<i class="las la-check text-xs text-primary-content" aria-hidden="true"></i>
				{/if}
			</span>
			<i
				class="las {option.icon} mb-3 block text-2xl {selected ? 'text-secondary' : 'text-neutral'}"
				aria-hidden="true"
			></i>
			<span class="block font-display text-lg font-bold text-base-content">{option.title}</span>
			<span class="block text-sm text-base-content-muted">{option.blurb}</span>
		</button>
	{/each}
</div>
