/**
 * Test-only. `mount()`'s `props` argument is read live by a runes component
 * (see Svelte's own `prop()` helper), so wrapping it in `$state` lets a mount
 * test simulate a parent re-rendering with new values — e.g. the realtime
 * refresh that updates `summary` out from under an open PaymentModal — by
 * mutating the returned object after mount. `$state` only works in a file
 * Svelte compiles (`*.svelte.ts`), which a plain `.test.ts` file is not.
 */
export function reactiveProps<T extends Record<string, unknown>>(value: T): T {
	const state = $state(value);
	return state;
}
