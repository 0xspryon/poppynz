<script lang="ts">
	/** Unmissable pink bar shown while an admin drives another user's session
	 * (design 12d): who is being impersonated, time left, and a stop button.
	 * Rendered by the user-app layouts whenever session.impersonatedBy is set. */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { stopImpersonating } from '$lib/api/admin-users';
	import { fetchSession, type MockSession } from '$lib/api/profile';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		session: MockSession;
	}

	let { session }: Props = $props();

	let stopping = $state(false);
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const remaining = $derived.by(() => {
		if (!session.sessionExpiresAt) return null;
		const ms = new Date(session.sessionExpiresAt).getTime() - now;
		if (ms <= 0) return '0:00';
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	});

	async function stop() {
		if (stopping) return;
		stopping = true;
		const result = await stopImpersonating();
		// Whether the call succeeded or the session already lapsed, re-read who
		// we are now — the session is the source of truth for where we land.
		const fresh = await fetchSession();
		if (fresh?.impersonatedBy != null) {
			// Still impersonating: the stop didn't take — stay put and say so.
			toast.error('Could not stop impersonating. Please try again.');
			stopping = false;
			return;
		}
		if (result.ok) {
			toast.success(`Stopped impersonating ${session.email}.`);
		}
		await goto(resolve('/admin/users'));
	}
</script>

<div class="flex items-center gap-3 bg-accent px-4 py-2.5 lg:px-5">
	<i class="las la-eye shrink-0 text-base text-accent-content" aria-hidden="true"></i>
	<span class="min-w-0 flex-1 text-[13px] font-semibold text-accent-content">
		You are impersonating <b>{session.email}</b> — everything you do happens on their account.
	</span>
	{#if remaining}
		<span class="hidden text-xs font-medium text-warning-content sm:block">{remaining} left</span>
	{/if}
	<button
		type="button"
		class="rounded-pill bg-base-100 px-4 py-1.5 text-xs font-bold text-warning
			transition-opacity hover:opacity-90"
		disabled={stopping}
		onclick={stop}
	>
		{stopping ? 'Stopping…' : 'Stop impersonating'}
	</button>
</div>
