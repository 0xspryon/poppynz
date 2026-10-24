<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	/** Impersonation confirm (design 12c) — better-auth rules spelled out up
	 * front. Opens while `user` is set. */
	interface Props {
		user: { name: string } | null;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { user, busy = false, onconfirm, oncancel }: Props = $props();
</script>

{#if user}
	<div
		class="modal modal-open"
		role="dialog"
		aria-label={m.admin_users_impersonate_aria({ name: user.name })}
	>
		<div class="modal-box max-w-130">
			<h2 class="text-lg font-bold">{m.admin_users_impersonate_title({ name: user.name })}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.admin_users_impersonate_body_before()} <b class="text-base-content">{user.name}</b>
				{m.admin_users_impersonate_body_after()}
			</p>

			<div class="mt-4 flex flex-col gap-2">
				<div
					class="flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-clock text-base text-info" aria-hidden="true"></i>
					<span class="text-[12.5px] text-info">
						{m.admin_users_impersonate_session_before()}
						<b>{m.admin_users_impersonate_session_strong()}</b
						>{m.admin_users_impersonate_session_after()}
					</span>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-file-alt text-base text-info" aria-hidden="true"></i>
					<span class="text-[12.5px] text-info">
						{m.admin_users_impersonate_audit_before()}
						<b>{m.admin_users_impersonate_audit_strong()}</b
						>{m.admin_users_impersonate_audit_after()}
					</span>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-md border border-error-content bg-error-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-exclamation-circle text-base text-error" aria-hidden="true"></i>
					<span class="text-[12.5px] text-error">
						{m.admin_users_impersonate_warning()}
					</span>
				</div>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="button" class="btn btn-secondary" disabled={busy} onclick={onconfirm}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{:else}
						<i class="las la-eye text-sm" aria-hidden="true"></i>
					{/if}
					{m.admin_users_impersonate_start()}
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}
		></button>
	</div>
{/if}
