<script lang="ts">
	/** The six-question vouch form plus the mandatory attestation. Emits the
	 * answers; the caller submits and closes. */
	import type { VouchAnswersInput } from '$lib/api/vouches';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		applicantName: string;
		busy?: boolean;
		onconfirm: (answers: VouchAnswersInput) => void;
		oncancel: () => void;
	}

	let { open, applicantName, busy = false, onconfirm, oncancel }: Props = $props();

	type Choice = 'yes' | 'no' | 'unsure';
	let howKnow = $state('');
	let howLong = $state('');
	let wouldTrust = $state<Choice | null>(null);
	let hasConcerns = $state<boolean | null>(null);
	let concernsDetail = $state('');
	let wouldHire = $state<Choice | null>(null);
	let anythingElse = $state('');
	let attested = $state(false);

	$effect(() => {
		if (open) {
			howKnow = '';
			howLong = '';
			wouldTrust = null;
			hasConcerns = null;
			concernsDetail = '';
			wouldHire = null;
			anythingElse = '';
			attested = false;
		}
	});

	const complete = $derived(
		howKnow.trim().length > 0 &&
			howLong.trim().length > 0 &&
			wouldTrust !== null &&
			hasConcerns !== null &&
			(hasConcerns === false || concernsDetail.trim().length > 0) &&
			wouldHire !== null &&
			attested
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!complete || busy || wouldTrust === null || wouldHire === null || hasConcerns === null) return;
		onconfirm({
			howKnow: howKnow.trim(),
			howLong: howLong.trim(),
			wouldTrust,
			hasConcerns,
			concernsDetail: hasConcerns ? concernsDetail.trim() : null,
			wouldHire,
			anythingElse: anythingElse.trim() || null,
			attested: true
		});
	}

	const choices: Array<{ value: Choice; label: string }> = [
		{ value: 'yes', label: m.common_yes() },
		{ value: 'no', label: m.common_no() },
		{ value: 'unsure', label: m.vouches_form_unsure() }
	];
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label={m.vouches_form_title({ name: applicantName })}>
		<form class="modal-box max-w-xl" onsubmit={submit}>
			<h2 class="text-lg font-bold">{m.vouches_form_title({ name: applicantName })}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				{m.vouches_form_intro_before()}
				<b>{m.vouches_form_intro_bold()}</b>{m.vouches_form_intro_after({ name: applicantName })}
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">{m.vouches_form_q1()}</legend>
				<textarea class="textarea w-full" maxlength="1000" bind:value={howKnow}></textarea>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.vouches_form_q2()}</legend>
				<input class="input w-full" maxlength="100" bind:value={howLong} placeholder={m.vouches_form_q2_placeholder()} />
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{m.vouches_form_q3()}
				</legend>
				<div class="flex gap-2">
					{#each choices as choice (choice.value)}
						<label class="flex items-center gap-1.5 text-sm">
							<input
								type="radio"
								class="radio radio-sm"
								name="wouldTrust"
								checked={wouldTrust === choice.value}
								onchange={() => (wouldTrust = choice.value)}
							/>
							{choice.label}
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{m.vouches_form_q4()}
				</legend>
				<div class="flex gap-2">
					<label class="flex items-center gap-1.5 text-sm">
						<input
							type="radio"
							class="radio radio-sm"
							name="hasConcerns"
							checked={hasConcerns === false}
							onchange={() => (hasConcerns = false)}
						/>
						{m.common_no()}
					</label>
					<label class="flex items-center gap-1.5 text-sm">
						<input
							type="radio"
							class="radio radio-sm"
							name="hasConcerns"
							checked={hasConcerns === true}
							onchange={() => (hasConcerns = true)}
						/>
						{m.common_yes()}
					</label>
				</div>
				{#if hasConcerns}
					<textarea
						class="textarea mt-2 w-full"
						maxlength="2000"
						placeholder={m.vouches_form_q4_placeholder()}
						bind:value={concernsDetail}
					></textarea>
				{/if}
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">{m.vouches_form_q5()}</legend>
				<div class="flex gap-2">
					{#each choices as choice (choice.value)}
						<label class="flex items-center gap-1.5 text-sm">
							<input
								type="radio"
								class="radio radio-sm"
								name="wouldHire"
								checked={wouldHire === choice.value}
								onchange={() => (wouldHire = choice.value)}
							/>
							{choice.label}
						</label>
					{/each}
				</div>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					{m.vouches_form_q6()}
				</legend>
				<textarea class="textarea w-full" maxlength="2000" bind:value={anythingElse}></textarea>
			</fieldset>

			<label class="mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed">
				<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={attested} />
				<span>
					{m.vouches_form_attestation()}
				</span>
			</label>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>{m.common_cancel()}</button>
				<button type="submit" class="btn btn-primary" disabled={!complete || busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					{m.vouches_form_submit()}
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label={m.common_close()} onclick={oncancel}></button>
	</div>
{/if}
