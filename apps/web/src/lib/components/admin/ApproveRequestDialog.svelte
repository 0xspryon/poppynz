<script lang="ts">
	import { formatDate, toDateInputValue, todayInputValue } from '$lib/date';
	import { m } from '$lib/paraglide/messages';
	/** Approve dialog (design 8c): approvals expire, so an explicit expiry date
	 * is required — presets fill the date input. Emits the chosen yyyy-mm-dd. */
	interface Props {
		open: boolean;
		applicantName: string;
		warningCount: number;
		warningText: string;
		/** What stops approval (UAT #25) — the server refuses while any remain. */
		blockers?: Array<string>;
		busy?: boolean;
		onconfirm: (expiryDate: string) => void;
		oncancel: () => void;
	}

	let {
		open,
		applicantName,
		warningCount,
		warningText,
		blockers = [],
		busy = false,
		onconfirm,
		oncancel
	}: Props = $props();

	const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
	type Preset = '6m' | '1y' | '2y' | 'custom';

	let preset = $state<Preset>('1y');
	let expiry = $state('');


	function setPreset(next: Preset) {
		preset = next;
		if (next === '6m') expiry = toDateInputValue(new Date(Date.now() + YEAR_MS / 2));
		if (next === '1y') expiry = toDateInputValue(new Date(Date.now() + YEAR_MS));
		if (next === '2y') expiry = toDateInputValue(new Date(Date.now() + 2 * YEAR_MS));
	}

	$effect(() => {
		if (open) setPreset('1y');
	});

	// Compared and shown as calendar dates in the admin's own zone — the
	// button once read "until Oct 10" for an Oct 11 expiry (UAT #28).
	const dateValid = $derived(expiry !== '' && expiry > todayInputValue());

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!dateValid || busy || blockers.length > 0) return;
		onconfirm(expiry);
	}
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label={m.admin_requests_approve_aria()}>
		<form class="modal-box" onsubmit={submit}>
			<h2 class="text-lg font-bold">{m.admin_requests_approve_title({ name: applicantName })}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.admin_requests_approve_intro()}
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.admin_requests_approve_valid_for()}</legend>
				<div class="flex gap-2">
					{#each [{ key: '6m', label: m.admin_requests_approve_preset_6m() }, { key: '1y', label: m.admin_requests_approve_preset_1y() }, { key: '2y', label: m.admin_requests_approve_preset_2y() }, { key: 'custom', label: m.admin_requests_approve_preset_custom() }] as entry (entry.key)}
						<button
							type="button"
							class="flex-1 rounded-md border-[1.5px] px-2 py-2.5 text-[13px] font-semibold
								{preset === entry.key
								? 'border-primary bg-base-400 text-secondary shadow-focus-ring'
								: 'border-outline-variant bg-base-100 text-base-content-muted'}"
							onclick={() => setPreset(entry.key as Preset)}
						>
							{entry.label}
						</button>
					{/each}
				</div>
			</fieldset>

			<fieldset class="fieldset mt-3">
				<legend class="fieldset-legend">{m.admin_requests_approve_expiry_label()}</legend>
				<input
					type="date"
					class="input w-full"
					bind:value={expiry}
					onchange={() => (preset = 'custom')}
				/>
				<p class="label text-xs">
					{m.admin_requests_approve_expiry_hint()}
				</p>
			</fieldset>

			{#if warningCount > 0}
				<div
					class="mt-3 flex items-center gap-2.5 rounded-md border border-warning-border
						bg-warning-content/40 px-3.5 py-2.5"
				>
					<i class="las la-exclamation-circle text-base text-warning" aria-hidden="true"></i>
					<span class="text-[12.5px] leading-relaxed text-warning">
						{m.admin_requests_approve_warning({ count: warningCount, text: warningText })}
					</span>
				</div>
			{/if}

			{#if blockers.length > 0}
				<div class="mt-3 rounded-md border border-error-content bg-error-content/40 px-3.5 py-2.5">
					<p class="text-[12.5px] font-semibold text-error">{m.admin_requests_approve_blockers()}</p>
					<ul class="mt-1 list-disc pl-5 text-[12.5px] text-error">
						{#each blockers as blocker (blocker)}<li>{blocker}</li>{/each}
					</ul>
				</div>
			{/if}

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="btn btn-primary" disabled={!dateValid || busy || blockers.length > 0}>
					{#if busy}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					{expiry
						? m.admin_requests_approve_submit_until({ date: formatDate(expiry) })
						: m.admin_requests_approve_submit()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}></button>
	</div>
{/if}
