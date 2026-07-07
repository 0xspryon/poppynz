<script lang="ts">
	interface Props {
		value: string;
		label?: string;
		id?: string;
		placeholder?: string;
		required?: boolean;
	}

	let {
		value = $bindable(''),
		label = 'Email',
		id = 'email',
		placeholder = 'you@example.com',
		required = true
	}: Props = $props();
</script>

<div>
	<label
		for={id}
		class="mb-2 block text-xs font-semibold tracking-widest text-neutral uppercase"
	>
		{label}
	</label>
	<div
		class="flex items-center gap-3 rounded-md border-2 border-outline-variant bg-base-100 px-4 py-3.5
			transition focus-within:border-primary focus-within:shadow-focus-ring"
	>
		<i class="las la-envelope text-lg text-outline" aria-hidden="true"></i>
		<input
			{id}
			type="email"
			{placeholder}
			{required}
			autocomplete="email"
			bind:value
			class="w-full bg-transparent text-base text-base-content outline-none placeholder:text-outline"
		/>
	</div>
</div>
