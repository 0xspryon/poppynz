<script lang="ts">
	/** Tick the tax components (GST, HST, …) a treatment or registration covers. */
	import { taxComponentLabel, type TaxComponent } from '$lib/api/tax';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		selected: Array<TaxComponent>;
		disabled?: boolean;
	}

	let { selected = $bindable(), disabled = false }: Props = $props();
	const COMPONENTS: Array<TaxComponent> = ['gst', 'hst', 'pst', 'qst', 'rst'];

	function toggle(component: TaxComponent, on: boolean) {
		selected = on
			? [...new Set([...selected, component])]
			: selected.filter((value) => value !== component);
	}
</script>

<fieldset class="flex flex-col gap-1" {disabled}>
	<legend class="mb-1 text-sm font-medium text-base-content">{m.tax_components_legend()}</legend>
	<div class="flex flex-wrap gap-4">
		{#each COMPONENTS as component (component)}
			<label class="flex items-center gap-1.5 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={selected.includes(component)}
					onchange={(event) => toggle(component, event.currentTarget.checked)}
				/>
				{taxComponentLabel(component)}
			</label>
		{/each}
	</div>
</fieldset>
