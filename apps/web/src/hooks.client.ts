import { baseLocale, overwriteGetLocale, toLocale } from '$lib/paraglide/runtime';

// The server already negotiated the locale (cookie, then Accept-Language)
// and stamped it on <html lang>. The client reads it back rather than
// re-negotiating from navigator.languages, so hydration always renders the
// same language as the server. Switching locale writes the cookie and
// reloads, which re-renders the document server-side in the new locale.
overwriteGetLocale(() => toLocale(document.documentElement.lang) ?? baseLocale);
