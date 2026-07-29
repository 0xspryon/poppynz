<script lang="ts">
	/** Family profile as seen by an approved provider. Location is approximate
	 * only — a shaded circle, never an exact pin or address. The Contact CTA
	 * ships enabled-looking; tapping opens a "messaging is coming soon" note so
	 * no layout rework is needed when messaging lands. `?from=` carries the
	 * search querystring for the back link; `?d=` carries the distance computed
	 * by the originating search. */
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getFamily, type FamilyDetail } from '$lib/api/families';
	import { withQuery } from '$lib/nav';

	let family = $state<FamilyDetail | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let loadError = $state(false);
	let comingSoonOpen = $state(false);
	let retryTick = $state(0);

	const userId = $derived(page.params.userId ?? '');
	const fromQs = $derived.by(() => {
		const raw = page.url.searchParams.get('from');
		if (!raw) return '';
		// Re-serialize through URLSearchParams so only a sane querystring survives.
		return new URLSearchParams(raw).toString();
	});
	const backHref = $derived(withQuery(resolve('/service-provider/find'), fromQs));
	const distanceKm = $derived.by(() => {
		const raw = Number(page.url.searchParams.get('d'));
		return Number.isFinite(raw) && raw > 0 ? raw : null;
	});

	$effect(() => {
		void retryTick;
		const id = userId;
		if (!id) return;
		loading = true;
		notFound = false;
		loadError = false;
		void getFamily(id).then((result) => {
			loading = false;
			if (result.ok) {
				family = result.data;
			} else if (
				result.error.code === 'FAMILY_NOT_FOUND' ||
				result.error.code === 'PROVIDER_NOT_APPROVED'
			) {
				notFound = true;
			} else {
				loadError = true;
			}
		});
	});

	const name = $derived(family ? (family.displayName ?? `Family in ${family.location.city}`) : '');
	const firstName = $derived(family?.displayName?.split(/\s+/)[0] ?? 'this family');
	const initials = $derived(
		(family?.displayName ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('')
	);
</script>

<svelte:head>
	<title>{name ? `${name} · Poppynz` : 'Family profile · Poppynz'}</title>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-5 pb-24 lg:pb-0">
	<a
		href={backHref}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		Back to results
	</a>

	{#if loading}
		<div class="flex flex-col gap-4 rounded-xl border border-card-border bg-base-100 p-6">
			<div class="flex items-center gap-5">
				<div class="skeleton size-[112px] shrink-0 rounded-full"></div>
				<div class="flex-1 space-y-3">
					<div class="skeleton h-6 w-1/2"></div>
					<div class="skeleton h-4 w-1/3"></div>
				</div>
			</div>
			<div class="skeleton h-4 w-full"></div>
			<div class="skeleton h-4 w-2/3"></div>
		</div>
	{:else if notFound}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center">
			<span class="flex size-14 items-center justify-center rounded-full bg-base-400">
				<i class="las la-user-slash text-2xl text-neutral" aria-hidden="true"></i>
			</span>
			<h1 class="font-display text-lg font-bold text-base-content">
				This family isn't available
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				They may have paused their listing. Head back to the results to keep browsing.
			</p>
			<a href={backHref} class="btn btn-primary btn-sm">
				Back to results
			</a>
		</div>
	{:else if loadError}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center">
			<span class="flex size-14 items-center justify-center rounded-full bg-error-content">
				<i class="las la-exclamation-triangle text-2xl text-error" aria-hidden="true"></i>
			</span>
			<h1 class="font-display text-lg font-bold text-base-content">
				Something went wrong on our side
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				This profile didn't load. Try again in a moment.
			</p>
			<button type="button" class="btn btn-primary btn-sm" onclick={() => (retryTick = retryTick + 1)}>
				<i class="las la-redo-alt" aria-hidden="true"></i>
				Retry
			</button>
		</div>
	{:else if family}
		<!-- Header card -->
		<div class="rounded-xl border border-card-border bg-base-100 p-6">
			<div class="flex flex-col items-center gap-5 text-center lg:flex-row lg:items-start lg:text-left">
				{#if family.image}
					<img src={family.image} alt="" class="size-[112px] shrink-0 rounded-full object-cover" />
				{:else}
					<span
						class="flex size-[112px] shrink-0 items-center justify-center rounded-full bg-base-500
							text-3xl font-bold text-secondary"
					>
						{#if initials}
							{initials}
						{:else}
							<i class="las la-home text-5xl" aria-hidden="true"></i>
						{/if}
					</span>
				{/if}

				<div class="min-w-0 flex-1">
					<h1 class="font-display text-3xl font-bold text-base-content">{name}</h1>
					<div class="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
						<span class="inline-flex items-center gap-1 text-sm text-base-content-muted">
							<i class="las la-map-marker" aria-hidden="true"></i>
							{family.location.city}, {family.location.stateProvince}
						</span>
						{#if distanceKm != null}
							<span class="rounded-pill bg-base-500 px-2.5 py-1 text-xs font-semibold text-info">
								{distanceKm} km from you
							</span>
						{/if}
					</div>
				</div>

				<div class="hidden shrink-0 flex-col items-end gap-2 lg:flex">
					<button type="button" class="btn btn-primary" onclick={() => (comingSoonOpen = !comingSoonOpen)}>
						Contact {firstName}
					</button>
					<span class="rounded-pill bg-warning-content px-2.5 py-1 text-[11px] font-bold text-warning">
						Messaging coming soon
					</span>
				</div>
			</div>
			{#if comingSoonOpen}
				<p class="mt-4 hidden rounded-lg bg-base-300 p-3 text-sm text-base-content-muted lg:block lg:text-right">
					Messaging is coming soon — you'll be able to reach {firstName} right from here.
				</p>
			{/if}
		</div>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
			<div class="flex flex-col gap-5">
				{#if family.shortBio}
					<section class="rounded-xl border border-card-border bg-base-100 p-6">
						<h2 class="mb-3 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
							About {firstName}
						</h2>
						<p class="text-sm leading-relaxed whitespace-pre-line text-base-content">
							{family.shortBio}
						</p>
					</section>
				{/if}

				<section class="rounded-xl border border-card-border bg-base-100 p-6">
					<h2 class="mb-3 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
						Help they're looking for
					</h2>
					<ul class="flex flex-col gap-2.5">
						{#each family.services as service (service.id)}
							<li class="rounded-lg bg-base-200 p-4">
								<div class="text-sm font-bold text-base-content">{service.name}</div>
								{#if service.description}
									<p class="mt-0.5 text-[13px] leading-relaxed text-base-content-muted">
										{service.description}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			</div>

			<div class="flex flex-col gap-5">
				<section class="rounded-xl border border-card-border bg-base-100 p-6">
					<h2 class="mb-3 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
						Location
					</h2>
					<!-- Approximate area only — never an exact pin or street address. -->
					<div
						class="relative flex h-40 items-center justify-center overflow-hidden rounded-lg
							bg-base-300"
						role="img"
						aria-label="Approximate area around {family.location.city}"
					>
						<span class="absolute size-24 rounded-full bg-primary/20"></span>
						<span class="absolute size-12 rounded-full bg-primary/25"></span>
						<span class="relative z-10 rounded-pill bg-base-100 px-2.5 py-1 text-[11px] font-semibold text-neutral">
							Approximate area
						</span>
					</div>
					<p class="mt-3 text-[13px] leading-relaxed text-base-content-muted">
						{firstName === 'this family' ? 'This family lives' : `${firstName}'s family lives`} around
						<strong class="text-base-content">
							{family.location.city}, {family.location.stateProvince}</strong
						>. For everyone's safety, Poppynz only ever shows an approximate area — never a street
						address.
					</p>
				</section>
			</div>
		</div>

		<!-- Sticky mobile CTA bar -->
		<div
			class="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 border-t
				border-card-border bg-base-100 p-3 shadow-[0_-4px_16px_rgba(26,51,117,0.08)] lg:hidden"
		>
			{#if comingSoonOpen}
				<p class="w-full rounded-lg bg-base-300 p-2.5 text-center text-[13px] text-base-content-muted">
					Messaging is coming soon — you'll be able to reach {firstName} right from here.
				</p>
			{/if}
			<span class="rounded-pill bg-warning-content px-2.5 py-0.5 text-[11px] font-bold text-warning">
				Messaging coming soon
			</span>
			<button
				type="button"
				class="btn w-full btn-primary"
				onclick={() => (comingSoonOpen = !comingSoonOpen)}
			>
				Contact {firstName}
			</button>
		</div>
	{/if}
</div>
