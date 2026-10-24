<script lang="ts">
	/** Family profile as seen by an approved provider. Location is approximate
	 * only — a shaded circle, never an exact pin or address. The Contact CTA
	 * opens the reach-out composer (design 16a); once a conversation exists it
	 * becomes a "Message" link into the thread. `?from=` carries the search
	 * querystring for the back link; `?d=` carries the distance computed by the
	 * originating search. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { lookupConversation, type ConversationLookup } from '$lib/api/conversations';
	import { getFamily, type FamilyDetail } from '$lib/api/families';
	import ReachoutComposerModal from '$lib/components/messages/ReachoutComposerModal.svelte';
	import { formatNumber } from '$lib/locale';
	import { withQuery } from '$lib/nav';
	import { m } from '$lib/paraglide/messages';

	let family = $state<FamilyDetail | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let loadError = $state(false);
	let composerOpen = $state(false);
	let conversation = $state<ConversationLookup>(null);
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

	// Whether a conversation with this family already exists decides the CTA:
	// composer (none) vs a link into the existing thread.
	$effect(() => {
		const id = userId;
		if (!id) return;
		conversation = null;
		void lookupConversation(id).then((result) => {
			if (result.ok) conversation = result.data.conversation;
		});
	});

	function openConversation(conversationId: string) {
		void goto(
			withQuery(resolve('/service-provider/messages'), `c=${encodeURIComponent(conversationId)}`)
		);
	}

	const name = $derived(
		family ? (family.displayName ?? m.provider_family_in_city({ city: family.location.city })) : ''
	);
	const firstName = $derived(family?.displayName?.split(/\s+/)[0] ?? null);
	const messageLabel = $derived(
		firstName ? m.provider_family_message_named({ name: firstName }) : m.provider_family_message()
	);
	const contactLabel = $derived(
		firstName ? m.provider_family_contact_named({ name: firstName }) : m.provider_family_contact()
	);
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
	<title
		>{name ? m.provider_family_page_title({ name }) : m.provider_family_page_title_default()}</title
	>
</svelte:head>

<div class="mx-auto flex max-w-5xl flex-col gap-5 pb-24 lg:pb-0">
	<a
		href={backHref}
		class="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary"
	>
		<i class="las la-angle-left" aria-hidden="true"></i>
		{m.provider_family_back()}
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
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<span class="flex size-14 items-center justify-center rounded-full bg-base-400">
				<i class="las la-user-slash text-2xl text-neutral" aria-hidden="true"></i>
			</span>
			<h1 class="font-display text-lg font-bold text-base-content">
				{m.provider_family_unavailable_title()}
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				{m.provider_family_unavailable_body()}
			</p>
			<a href={backHref} class="btn btn-primary btn-sm">{m.provider_family_back()}</a>
		</div>
	{:else if loadError}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-base-100 px-6 py-14 text-center"
		>
			<span class="flex size-14 items-center justify-center rounded-full bg-error-content">
				<i class="las la-exclamation-triangle text-2xl text-error" aria-hidden="true"></i>
			</span>
			<h1 class="font-display text-lg font-bold text-base-content">
				{m.provider_family_error_title()}
			</h1>
			<p class="max-w-sm text-sm text-base-content-muted">
				{m.provider_family_error_body()}
			</p>
			<button
				type="button"
				class="btn btn-primary btn-sm"
				onclick={() => (retryTick = retryTick + 1)}
			>
				<i class="las la-redo-alt" aria-hidden="true"></i>
				{m.provider_family_retry()}
			</button>
		</div>
	{:else if family}
		<!-- Header card -->
		<div class="rounded-xl border border-card-border bg-base-100 p-6">
			<div
				class="flex flex-col items-center gap-5 text-center lg:flex-row lg:items-start lg:text-left"
			>
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
								{m.provider_family_distance({ distance: formatNumber(distanceKm) })}
							</span>
						{/if}
					</div>
				</div>

				<div class="hidden shrink-0 flex-col items-end gap-2 lg:flex">
					{#if conversation}
						<a
							href={withQuery(
								resolve('/service-provider/messages'),
								`c=${encodeURIComponent(conversation.id)}`
							)}
							class="btn btn-primary"
						>
							{messageLabel}
						</a>
						{#if conversation.status === 'pending'}
							<span
								class="rounded-pill bg-warning-content px-2.5 py-1 text-[11px] font-bold text-warning"
							>
								{conversation.awaitingMyResponse
									? m.provider_family_reachout_awaiting_you()
									: m.provider_family_awaiting_response()}
							</span>
						{/if}
					{:else}
						<button type="button" class="btn btn-primary" onclick={() => (composerOpen = true)}>
							{contactLabel}
						</button>
					{/if}
				</div>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
			<div class="flex flex-col gap-5">
				{#if family.shortBio}
					<section class="rounded-xl border border-card-border bg-base-100 p-6">
						<h2 class="mb-3 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
							{firstName
								? m.provider_family_about_named({ name: firstName })
								: m.provider_family_about()}
						</h2>
						<p class="text-sm leading-relaxed whitespace-pre-line text-base-content">
							{family.shortBio}
						</p>
					</section>
				{/if}

				<section class="rounded-xl border border-card-border bg-base-100 p-6">
					<h2 class="mb-3 text-[10px] font-semibold tracking-[0.1em] text-neutral uppercase">
						{m.provider_family_help_heading()}
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
						{m.provider_family_location_heading()}
					</h2>
					<!-- Approximate area only — never an exact pin or street address. -->
					<div
						class="relative flex h-40 items-center justify-center overflow-hidden rounded-lg
							bg-base-300"
						role="img"
						aria-label={m.provider_family_area_aria({ city: family.location.city })}
					>
						<span class="absolute size-24 rounded-full bg-primary/20"></span>
						<span class="absolute size-12 rounded-full bg-primary/25"></span>
						<span
							class="relative z-10 rounded-pill bg-base-100 px-2.5 py-1 text-[11px] font-semibold text-neutral"
						>
							{m.provider_family_area_label()}
						</span>
					</div>
					<p class="mt-3 text-[13px] leading-relaxed text-base-content-muted">
						{firstName
							? m.provider_family_lives_named_before({ name: firstName })
							: m.provider_family_lives_before()}
						<strong class="text-base-content">
							{family.location.city}, {family.location.stateProvince}</strong
						>{m.provider_family_lives_after()}
					</p>
				</section>
			</div>
		</div>

		<!-- Sticky mobile CTA bar -->
		<div
			class="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 border-t
				border-card-border bg-base-100 p-3 shadow-[0_-4px_16px_rgba(26,51,117,0.08)] lg:hidden"
		>
			{#if conversation}
				{#if conversation.status === 'pending'}
					<span
						class="rounded-pill bg-warning-content px-2.5 py-0.5 text-[11px] font-bold text-warning"
					>
						{conversation.awaitingMyResponse
							? m.provider_family_reachout_awaiting_you()
							: m.provider_family_awaiting_response()}
					</span>
				{/if}
				<a
					href={withQuery(
						resolve('/service-provider/messages'),
						`c=${encodeURIComponent(conversation.id)}`
					)}
					class="btn w-full btn-primary"
				>
					{messageLabel}
				</a>
			{:else}
				<button type="button" class="btn w-full btn-primary" onclick={() => (composerOpen = true)}>
					{contactLabel}
				</button>
			{/if}
		</div>

		<ReachoutComposerModal
			open={composerOpen}
			onclose={() => (composerOpen = false)}
			recipient={{ userId, name }}
			services={family.services.map((service) => ({ id: service.id, name: service.name }))}
			senderRole="service-provider"
			onconversation={openConversation}
		/>
	{/if}
</div>
