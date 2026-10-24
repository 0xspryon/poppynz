import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';

/**
 * Resolves the request's locale (PARAGLIDE_LOCALE cookie, then
 * Accept-Language, then English) and renders the page in it. Paraglide keeps
 * the locale in AsyncLocalStorage, so concurrent requests never share one.
 */
export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) =>
		resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) =>
					html
						.replace('%paraglide.lang%', locale)
						.replace('%paraglide.dir%', getTextDirection(locale))
			}
		)
	);
