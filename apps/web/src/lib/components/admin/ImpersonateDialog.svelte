<script lang="ts">
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
	<div class="modal modal-open" role="dialog" aria-label="Impersonate {user.name}">
		<div class="modal-box max-w-130">
			<h2 class="text-lg font-bold">Impersonate {user.name}?</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				You will be signed in as <b class="text-base-content">{user.name}</b> and see exactly what they
				see. Anything you do happens on their real account.
			</p>

			<div class="mt-4 flex flex-col gap-2">
				<div
					class="flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-clock text-base text-info" aria-hidden="true"></i>
					<span class="text-[12.5px] text-info">
						Session ends automatically after <b>1 hour</b>, or when you stop it.
					</span>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-md border border-info-content bg-info-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-file-alt text-base text-info" aria-hidden="true"></i>
					<span class="text-[12.5px] text-info">
						The session is stamped <b>impersonated by you</b> in the audit log.
					</span>
				</div>
				<div
					class="flex items-center gap-2.5 rounded-md border border-error-content bg-error-content/40
						px-3.5 py-2.5"
				>
					<i class="las la-exclamation-circle text-base text-error" aria-hidden="true"></i>
					<span class="text-[12.5px] text-error">
						Use only to troubleshoot — the user is not notified.
					</span>
				</div>
			</div>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					Cancel
				</button>
				<button type="button" class="btn btn-secondary" disabled={busy} onclick={onconfirm}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{:else}
						<i class="las la-eye text-sm" aria-hidden="true"></i>
					{/if}
					Start impersonating
				</button>
			</div>
		</div>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
