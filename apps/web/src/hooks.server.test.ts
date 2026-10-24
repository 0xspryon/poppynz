import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

/** Runs the server hook for a document request and returns the rendered
 * <html> tag, as SvelteKit would after transformPageChunk. */
const renderHtmlTag = async (headers: Record<string, string>) => {
	const request = new Request('http://localhost/auth/sign-in', {
		headers: { 'sec-fetch-dest': 'document', ...headers }
	});
	const event = { request, url: new URL(request.url) } as unknown as RequestEvent;
	const response = await handle({
		event,
		resolve: async (_event: RequestEvent, options?: ResolveOptions) => {
			const html = '<html lang="%paraglide.lang%" dir="%paraglide.dir%">';
			const out = (await options?.transformPageChunk?.({ html, done: true })) ?? html;
			return new Response(out);
		}
	});
	return response.text();
};

describe('locale resolution (server hook)', () => {
	it('uses the PARAGLIDE_LOCALE cookie first', async () => {
		await expect(
			renderHtmlTag({ cookie: 'PARAGLIDE_LOCALE=fr', 'accept-language': 'en-CA,en;q=0.9' })
		).resolves.toBe('<html lang="fr" dir="ltr">');
	});

	it('falls back to Accept-Language when there is no cookie', async () => {
		await expect(renderHtmlTag({ 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' })).resolves.toBe(
			'<html lang="fr" dir="ltr">'
		);
	});

	it('ignores a cookie for an unsupported locale (the retired es)', async () => {
		await expect(
			renderHtmlTag({ cookie: 'PARAGLIDE_LOCALE=es', 'accept-language': 'fr' })
		).resolves.toBe('<html lang="fr" dir="ltr">');
	});

	it('defaults to English when neither names a supported locale', async () => {
		await expect(renderHtmlTag({ 'accept-language': 'es-MX,de;q=0.8' })).resolves.toBe(
			'<html lang="en" dir="ltr">'
		);
		await expect(renderHtmlTag({})).resolves.toBe('<html lang="en" dir="ltr">');
	});
});
