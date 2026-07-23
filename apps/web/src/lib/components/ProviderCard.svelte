<script lang="ts">
	/** Marketplace result card (design 13e). Tolerates every data variant:
	 * null photo → initials avatar, null name → "Provider in {city}" + generic
	 * glyph, null bio → chips move up, distance chip only when geo-searching.
	 * Never fabricates data — no stars, response times or availability. */
	import type { ResolvedPathname } from '$app/types';
	import type { ProviderHit } from '$lib/api/providers';
	import { rateRangeLabel } from '$lib/money';

	interface Props {
		provider: ProviderHit;
		href: ResolvedPathname;
	}

	let { provider, href }: Props = $props();

	const name = $derived(provider.displayName ?? `Provider in ${provider.location.city}`);
	const anonymous = $derived(provider.displayName == null);
	const initials = $derived(
		(provider.displayName ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('')
	);
	const shownServices = $derived(provider.services.slice(0, 3));
	const overflow = $derived(provider.services.length - shownServices.length);
	const rate = $derived(rateRangeLabel(provider.minHourlyRateCents, provider.maxHourlyRateCents));
</script>

<a
	{href}
	class="flex flex-col gap-2.5 rounded-xl border border-card-border bg-base-100 p-4
		transition-shadow hover:shadow-md"
>
	<div class="flex items-start gap-3">
		{#if provider.image}
			<img
				src={provider.image}
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
					<i class="las la-user text-2xl" aria-hidden="true"></i>
				{:else}
					{initials}
				{/if}
			</span>
		{/if}

		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-1.5">
				<span class="font-display text-[15px] font-bold text-base-content">{name}</span>
				<span
					class="inline-flex items-center gap-1 rounded-pill bg-success-content px-2 py-0.5
						text-[10px] font-bold text-success"
				>
					<i class="las la-user-shield" aria-hidden="true"></i>
					Vetted
				</span>
			</div>
			<div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-base-content-muted">
				<span class="truncate">{provider.location.city}, {provider.location.stateProvince}</span>
				{#if provider.distanceKm !== undefined}
					<span class="rounded-pill bg-base-500 px-2 py-0.5 text-[11px] font-semibold text-info">
						{provider.distanceKm} km
					</span>
				{/if}
			</div>
		</div>
	</div>

	{#if provider.shortBio}
		<p class="line-clamp-2 text-[13px] leading-relaxed text-base-content-muted">
			{provider.shortBio}
		</p>
	{/if}

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

	<div class="mt-auto border-t border-base-300 pt-2.5">
		<span class="font-display text-[15px] font-bold text-secondary">{rate}</span>
	</div>
</a>
