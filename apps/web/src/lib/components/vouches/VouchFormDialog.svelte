<script lang="ts">
	/** The six-question vouch form plus the mandatory attestation. Emits the
	 * answers; the caller submits and closes. */
	import type { VouchAnswersInput } from '$lib/api/vouches';

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
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' },
		{ value: 'unsure', label: 'Not sure' }
	];
</script>

{#if open}
	<div class="modal modal-open" role="dialog" aria-label="Vouch for {applicantName}">
		<form class="modal-box max-w-xl" onsubmit={submit}>
			<h2 class="text-lg font-bold">Vouch for {applicantName}</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-base-content-muted">
				A vouch is a <b>personal endorsement</b>. Your answers are seen only by the Poppynz team, never
				by {applicantName}.
			</p>

			<fieldset class="fieldset mt-4">
				<legend class="fieldset-legend">1. How do you know the applicant?</legend>
				<textarea class="textarea w-full" maxlength="1000" bind:value={howKnow}></textarea>
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">2. How long have you known them?</legend>
				<input class="input w-full" maxlength="100" bind:value={howLong} placeholder="e.g. 3 years" />
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">
					3. Would you trust this person to provide care for a child, older adult, pet, or household?
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
					4. Do you have any concerns about their reliability, judgment, safety, or conduct?
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
						No
					</label>
					<label class="flex items-center gap-1.5 text-sm">
						<input
							type="radio"
							class="radio radio-sm"
							name="hasConcerns"
							checked={hasConcerns === true}
							onchange={() => (hasConcerns = true)}
						/>
						Yes
					</label>
				</div>
				{#if hasConcerns}
					<textarea
						class="textarea mt-2 w-full"
						maxlength="2000"
						placeholder="Please tell us more"
						bind:value={concernsDetail}
					></textarea>
				{/if}
			</fieldset>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">5. Would you personally hire or recommend them?</legend>
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
					6. Is there anything Poppynz should know before approving them? · optional
				</legend>
				<textarea class="textarea w-full" maxlength="2000" bind:value={anythingElse}></textarea>
			</fieldset>

			<label class="mt-3 flex items-start gap-2.5 text-[13px] leading-relaxed">
				<input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={attested} />
				<span>
					I confirm that I know this applicant personally and that the information I have provided is
					truthful. I understand that Poppynz may contact me to verify this referral.
				</span>
			</label>

			<div class="modal-action">
				<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>Cancel</button>
				<button type="submit" class="btn btn-primary" disabled={!complete || busy}>
					{#if busy}<span class="loading loading-spinner loading-sm"></span>{/if}
					Submit vouch
				</button>
			</div>
		</form>
		<button type="button" class="modal-backdrop" aria-label="Close" onclick={oncancel}></button>
	</div>
{/if}
