<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		banUser,
		impersonateUser,
		listAdminUsers,
		unbanUser,
		type AdminUser,
		type AdminUserList
	} from '$lib/api/admin-users';
	import { fetchSession } from '$lib/api/profile';
	import { resolveLanding } from '$lib/role-landing';
	import BanUserDialog from '$lib/components/admin/BanUserDialog.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';
	import ImpersonateDialog from '$lib/components/admin/ImpersonateDialog.svelte';
	import { intlLocale } from '$lib/locale';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/toast.svelte';
	import { getCardDisputeFlags, type CardDisputeFlag } from '$lib/api/card-disputes';

	/** better-auth words its failures in English; show a localized message for
	 * the operation instead (network vs. server). */
	const failureText = (error: { status: number | null }) =>
		error.status === null ? m.common_error_network() : m.common_error_generic();
	type Filter = 'all' | 'providers' | 'families' | 'admins' | 'banned';

	let data = $state<AdminUserList | null>(null);
	let loading = $state(true);
	let errorMessage = $state('');
	let filter = $state<Filter>('all');
	let search = $state('');

	/** User the impersonate confirm dialog (12c) is open for. */
	let impersonateTarget = $state<AdminUser | null>(null);
	let impersonating = $state(false);
	/** User the ban dialog is open for. */
	let banTarget = $state<AdminUser | null>(null);
	let banning = $state(false);
	/** User the unban confirm is open for. */
	let unbanTarget = $state<AdminUser | null>(null);
	let unbanning = $state(false);

	/** Families with an open card dispute or contracts an admin holds (Tier
	 * 3 step 4): flagged here for review. Best-effort: no banner on failure. */
	let disputeFlags = $state<Record<string, CardDisputeFlag>>({});

	async function loadDisputeFlags() {
		const result = await getCardDisputeFlags();
		if (result.ok) {
			disputeFlags = Object.fromEntries(result.data.families.map((row) => [row.userId, row]));
		}
	}

	async function load() {
		errorMessage = '';
		void loadDisputeFlags();
		const result = await listAdminUsers();
		if (result.ok) {
			data = result.data;
		} else {
			errorMessage =
				result.error.code === 'FORBIDDEN' || result.error.code === 'UNAUTHORIZED'
					? m.admin_users_error_forbidden()
					: m.common_error_generic();
		}
		loading = false;
	}

	onMount(() => {
		void load();
	});

	function roleLabel(role: string): string {
		if (role === 'service-provider') return m.admin_users_role_provider();
		if (role === 'family') return m.admin_users_role_family();
		if (role === 'admin') return m.admin_users_role_admin();
		return role;
	}

	function initials(user: AdminUser): string {
		const parts = user.name.split(' ').filter(Boolean);
		const letters = parts.map((part) => part.charAt(0)).join('');
		return (letters || user.email.charAt(0)).slice(0, 2).toUpperCase();
	}

	function joinedText(user: AdminUser): string {
		return new Date(user.createdAt).toLocaleDateString(intlLocale(), {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	const filtered = $derived.by(() => {
		if (!data) return [];
		const query = search.trim().toLowerCase();
		return data.users.filter((user) => {
			if (filter === 'providers' && user.role !== 'service-provider') return false;
			if (filter === 'families' && user.role !== 'family') return false;
			if (filter === 'admins' && user.role !== 'admin') return false;
			if (filter === 'banned' && !user.banned) return false;
			if (query && !`${user.name} ${user.email}`.toLowerCase().includes(query)) return false;
			return true;
		});
	});

	const filters = $derived.by((): Array<{ key: Filter; label: string }> => {
		const users = data?.users ?? [];
		const count = (predicate: (user: AdminUser) => boolean) => users.filter(predicate).length;
		const label = (text: string, value: number) =>
			m.admin_users_filter_count({ label: text, count: value });
		return [
			{ key: 'all', label: label(m.admin_users_filter_all(), users.length) },
			{
				key: 'providers',
				label: label(
					m.admin_users_filter_providers(),
					count((u) => u.role === 'service-provider')
				)
			},
			{
				key: 'families',
				label: label(
					m.admin_users_filter_families(),
					count((u) => u.role === 'family')
				)
			},
			{
				key: 'admins',
				label: label(
					m.admin_users_filter_admins(),
					count((u) => u.role === 'admin')
				)
			},
			{
				key: 'banned',
				label: label(
					m.admin_users_filter_banned(),
					count((u) => u.banned)
				)
			}
		];
	});

	/** Admins and banned users get no Impersonate button (12b) — better-auth
	 * enforces the same rules server-side. */
	function canImpersonate(user: AdminUser): boolean {
		return user.role !== 'admin' && !user.banned;
	}

	async function confirmImpersonate() {
		if (!impersonateTarget || impersonating) return;
		impersonating = true;
		const result = await impersonateUser(impersonateTarget.id);
		if (!result.ok) {
			toast.error(failureText(result.error), {
				title: m.admin_users_toast_impersonate_failed({ name: impersonateTarget.name })
			});
			impersonating = false;
			impersonateTarget = null;
			return;
		}
		// The cookie now belongs to the impersonated user — refresh the cached
		// session and land where they would land.
		const session = await fetchSession();
		await goto((await resolveLanding(session?.role)) ?? resolve('/'));
	}

	async function confirmBan(reason: string | undefined) {
		if (!banTarget || banning) return;
		banning = true;
		const result = await banUser(banTarget.id, reason);
		if (result.ok) {
			toast.success(m.admin_users_toast_banned({ name: banTarget.name }));
		} else {
			toast.error(failureText(result.error), {
				title: m.admin_users_toast_ban_failed({ name: banTarget.name })
			});
		}
		banning = false;
		banTarget = null;
		await load();
	}

	async function confirmUnban() {
		if (!unbanTarget || unbanning) return;
		unbanning = true;
		const result = await unbanUser(unbanTarget.id);
		if (result.ok) {
			toast.success(m.admin_users_toast_unbanned({ name: unbanTarget.name }));
		} else {
			toast.error(failureText(result.error), {
				title: m.admin_users_toast_unban_failed({ name: unbanTarget.name })
			});
		}
		unbanning = false;
		unbanTarget = null;
		await load();
	}
</script>

<svelte:head>
	<title>{m.admin_users_page_title()}</title>
</svelte:head>

<div class="mx-auto max-w-5xl">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-base-content lg:text-[26px]">{m.admin_users_heading()}</h1>
			<p class="mt-1 text-sm text-base-content-muted">
				{m.admin_users_subheading()}
			</p>
		</div>
		<label class="input w-full sm:w-60">
			<i class="las la-search text-base text-outline" aria-hidden="true"></i>
			<input type="search" placeholder={m.admin_users_search_placeholder()} bind:value={search} />
		</label>
	</div>

	<div class="mt-4 mb-4 flex flex-wrap gap-1.5">
		{#each filters as entry (entry.key)}
			<button
				type="button"
				class="rounded-pill px-4 py-2 text-[12.5px]
					{filter === entry.key
					? 'bg-secondary font-semibold text-secondary-content'
					: 'border border-outline-variant bg-base-100 font-medium text-base-content-muted'}"
				onclick={() => (filter = entry.key)}
			>
				{entry.label}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex justify-center py-24">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if errorMessage}
		<p role="alert" class="text-sm font-medium text-error">{errorMessage}</p>
	{:else if filtered.length === 0}
		<p
			class="rounded-xl border border-card-border bg-base-100 p-8 text-center text-sm text-base-content-muted"
		>
			{m.admin_users_empty()}
		</p>
	{:else}
		<div
			class="hidden grid-cols-[minmax(200px,250px)_110px_100px_110px_1fr] gap-3.5 px-4 pb-2
				text-[10.5px] font-semibold tracking-[0.08em] text-outline uppercase lg:grid"
		>
			<span>{m.admin_users_col_user()}</span>
			<span>{m.admin_users_col_role()}</span>
			<span>{m.admin_users_col_status()}</span>
			<span>{m.admin_users_col_joined()}</span>
			<span class="text-right">{m.admin_users_col_actions()}</span>
		</div>
		<div class="flex flex-col gap-2">
			{#each filtered as user (user.id)}
				<div
					class="rounded-[10px] border border-card-border bg-base-100 p-4
						lg:grid lg:grid-cols-[minmax(200px,250px)_110px_100px_110px_1fr] lg:items-center
						lg:gap-3.5"
				>
					<div class="flex min-w-0 items-center gap-2.5">
						<span
							class="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-base-400
								text-[13px] font-bold text-secondary"
						>
							{initials(user)}
						</span>
						<div class="min-w-0">
							<div class="truncate text-[13.5px] font-semibold text-base-content">{user.name}</div>
							<div class="truncate text-[11.5px] text-outline">{user.email}</div>
							{#if disputeFlags[user.id]}
								<a
									class="mt-1 inline-block rounded-[5px] bg-warning-content px-2 py-0.5 text-[11px]
										font-semibold text-warning"
									href={resolve('/admin/card-disputes')}
									data-testid="user-card-dispute"
								>
									{disputeFlags[user.id]?.suspended
										? m.admin_users_contracts_on_hold()
										: m.admin_users_card_dispute()}
								</a>
							{/if}
						</div>
					</div>
					<div class="mt-2 lg:mt-0">
						<span
							class="rounded-[5px] bg-base-400 px-2.5 py-1 text-[11px] font-semibold
								whitespace-nowrap text-neutral"
						>
							{user.role ? roleLabel(user.role) : '—'}
						</span>
					</div>
					<div class="mt-2 lg:mt-0">
						{#if user.banned}
							<span
								class="rounded-[5px] bg-error-content px-2.5 py-1 text-[11px] font-semibold
									whitespace-nowrap text-error"
								title={user.banReason ?? undefined}
							>
								{m.admin_users_status_banned()}
							</span>
						{:else}
							<span
								class="rounded-[5px] bg-success-content px-2.5 py-1 text-[11px] font-semibold
									whitespace-nowrap text-success"
							>
								{m.admin_users_status_active()}
							</span>
						{/if}
					</div>
					<div class="mt-1 text-xs text-base-content-muted lg:mt-0 lg:text-[12.5px]">
						{joinedText(user)}
					</div>
					<div class="mt-3 flex flex-wrap gap-2 lg:mt-0 lg:justify-end">
						{#if canImpersonate(user)}
							<button
								type="button"
								class="btn btn-sm btn-outline btn-secondary"
								onclick={() => (impersonateTarget = user)}
							>
								<i class="las la-eye text-sm" aria-hidden="true"></i>
								{m.admin_users_impersonate()}
							</button>
						{/if}
						{#if user.role !== 'admin'}
							{#if user.banned}
								<button
									type="button"
									class="btn btn-sm btn-outline"
									onclick={() => (unbanTarget = user)}
								>
									{m.admin_users_unban()}
								</button>
							{:else}
								<button
									type="button"
									class="btn btn-sm btn-outline btn-error"
									onclick={() => (banTarget = user)}
								>
									{m.admin_users_ban()}
								</button>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<ImpersonateDialog
	user={impersonateTarget}
	busy={impersonating}
	onconfirm={() => void confirmImpersonate()}
	oncancel={() => (impersonateTarget = null)}
/>

<BanUserDialog
	user={banTarget}
	busy={banning}
	onconfirm={(reason) => void confirmBan(reason)}
	oncancel={() => (banTarget = null)}
/>

<ConfirmDialog
	open={unbanTarget !== null}
	title={m.admin_users_unban_title({ name: unbanTarget?.name ?? '' })}
	body={m.admin_users_unban_body()}
	confirmLabel={m.admin_users_unban()}
	confirmClass="btn-secondary"
	busy={unbanning}
	onconfirm={() => void confirmUnban()}
	oncancel={() => (unbanTarget = null)}
/>
