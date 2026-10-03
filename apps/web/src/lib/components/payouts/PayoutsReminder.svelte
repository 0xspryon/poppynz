<script lang="ts">
	/** Shown in the helper's accept confirmation while payouts aren't ready.
	 * A reminder only — accepting is never blocked (piece 2b). */
	import { resolve } from '$app/paths';
</script>

<p class="rounded-lg bg-base-200 px-3 py-2.5 text-[13px] leading-relaxed text-base-content" role="note">
	<strong>You'll need a payout account to collect your earnings.</strong>
	<a class="link font-semibold link-primary" href={resolve('/service-provider/payouts')}>Set it up now</a>, or later — you'll be asked again before your first payment.
</p>
