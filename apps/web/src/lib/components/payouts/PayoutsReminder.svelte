<script lang="ts">
	/** Shown in the helper's accept confirmation while payouts aren't ready.
	 * A reminder only — accepting is never blocked (piece 2b). */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
</script>

<p
	class="rounded-lg bg-base-200 px-3 py-2.5 text-[13px] leading-relaxed text-base-content"
	role="note"
>
	<strong>{m.payouts_reminder_title()}</strong>
	<a class="link font-semibold link-primary" href={resolve('/service-provider/payouts')}
		>{m.payouts_reminder_link()}</a
	>{m.payouts_reminder_after()}
</p>
