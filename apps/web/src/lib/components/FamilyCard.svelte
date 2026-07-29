<script lang="ts">
	/** Family search result card (provider marketplace). Tolerates every data
	 * variant: null photo → initials avatar, null name → "Family in {city}" +
	 * generic glyph, null bio → chips move up, distance chip only when
	 * geo-searching. No rates — families describe needs, providers price them. */
	import type { ResolvedPathname } from '$app/types';
	import type { FamilyHit } from '$lib/api/families';

	interface Props {
		family: FamilyHit;
		href: ResolvedPathname;
	}

	let { family, href }: Props = $props();

	const name = $derived(family.displayName ?? `Family in ${family.location.city}`);
	const anonymous = $derived(family.displayName == null);
	const initials = $derived(
		(family.displayName ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('')
	);
	const shownServices = $derived(family.services.slice(0, 3));
	const overflow = $derived(family.services.length - shownServices.length);
</script>

<a
	{href}
	class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4
		transition-shadow hover:shadow-md"
>
	<div class="flex items-start gap-3">
		{#if family.image}
			<img
				src={family.image}
				alt=""
				class="size-[52px] shrink-0 rounded-full object-cover"
				loading="lazy"
			/>
		{:else}
			<span
				class="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-base-500
					text-base font-bold text-secondary"
			>
				{#if anonymous}
					<i class="las la-home text-2xl" aria-hidden="true"></i>
				{:else}
					{initials}
				{/if}
			</span>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="font-display text-[15px] font-bold text-base-content">{name}</span>
			</div>
			<div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-base-content-muted">
				<span class="truncate">{family.location.city}, {family.location.stateProvince}</span>
				{#if family.distanceKm !== undefined}
					<span class="rounded-pill bg-base-500 px-2 py-0.5 text-[11px] font-semibold text-info">
						{family.distanceKm} km
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if family.shortBio}
		<p class="line-clamp-2 text-[13px] leading-relaxed text-base-content-muted">
			{family.shortBio}
		</p>
	{/if}

	<div class="mt-auto">
		<div class="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
			Looking for
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each shownServices as service (service)}
				<span
					class="max-w-full truncate rounded-pill bg-base-300 px-2.5 py-1 text-[11px] font-semibold
						text-neutral"
				>
					{service}
				</span>
			{/each}
			{#if overflow > 0}
				<span
					class="rounded-pill border border-dashed border-outline-variant px-2.5 py-1 text-[11px]
						font-semibold text-base-content-muted"
				>
					+{overflow} more
				</span>
			{/if}
		</div>
	</div>
</a>
