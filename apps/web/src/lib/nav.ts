import type { ResolvedPathname } from '$app/types';

/**
 * Append a querystring (without `?`) to a resolve()d pathname while keeping
 * the `ResolvedPathname` brand, so `svelte/no-navigation-without-resolve`
 * recognizes hrefs/goto() targets that carry search params.
 */
export function withQuery(path: ResolvedPathname, qs: string): ResolvedPathname {
	return (qs ? `${path}?${qs}` : path) as ResolvedPathname;
}
