import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSignInLink, requestSignUpLink, verifyMagicLink, type SignInLinkError } from './auth';
import { matchError, type UnexpectedError } from './client';

describe('requestSignUpLink / requestSignInLink', () => {
	const okResponse = () =>
		new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('posts sign-ups to the sign-up endpoint with email and role', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse());
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestSignUpLink({
			email: 'jane@example.com',
			role: 'service-provider'
		});

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toBe('/api/v1/auth/sign-up');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({
			email: 'jane@example.com',
			role: 'service-provider'
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toMatchObject({
				email: 'jane@example.com',
				role: 'service-provider',
				intent: 'sign-up'
			});
		}
	});

	it('posts sign-ins to the sign-in endpoint with only the email', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okResponse());
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestSignInLink({ email: 'jane@example.com' });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toBe('/api/v1/auth/sign-in');
		expect(JSON.parse(String(init.body))).toEqual({ email: 'jane@example.com' });
		expect(result.ok).toBe(true);
	});

	it('returns the typed error code from an API error response', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: { code: 'USER_NOT_FOUND', message: 'No account exists for this email.' }
				}),
				{ status: 404, headers: { 'content-type': 'application/json' } }
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await requestSignInLink({ email: 'jane@example.com' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('USER_NOT_FOUND');
		}
	});

	it('returns UNEXPECTED with null status when the request cannot be sent', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

		const result = await requestSignInLink({ email: 'jane@example.com' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({
				code: 'UNEXPECTED',
				message: 'The request could not be sent.',
				status: null
			});
		}
	});

	it('returns UNEXPECTED with the status for a non-JSON error response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
		);

		const result = await requestSignInLink({ email: 'jane@example.com' });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('UNEXPECTED');
			if (result.error.code === 'UNEXPECTED') {
				expect(result.error.status).toBe(502);
			}
		}
	});
});

describe('matchError', () => {
	type TestError = { code: 'A'; message: string } | UnexpectedError;

	it('dispatches to the handler for the error code', () => {
		// widen to the full union so matchError demands handlers for every code
		const error = { code: 'A', message: 'a' } as TestError;
		const out = matchError(error, {
			A: (e) => `handled:${e.message}`,
			UNEXPECTED: () => 'unexpected'
		});
		expect(out).toBe('handled:a');
	});

	it('falls back to UNEXPECTED for codes outside the typed contract', () => {
		const drifted = { code: 'BRAND_NEW_CODE', message: 'x' } as unknown as TestError;
		const out = matchError(drifted, {
			A: () => 'a',
			UNEXPECTED: () => 'unexpected'
		});
		expect(out).toBe('unexpected');
	});

	it('requires a handler for every code in the union (compile-time guarantee)', () => {
		const error = { code: 'UNEXPECTED', message: '', status: null } as SignInLinkError;
		const out = matchError(
			error,
			// @ts-expect-error — USER_NOT_FOUND is deliberately missing; if this stops
			// being a compile error, the exhaustiveness guarantee has regressed.
			{
				INVALID_SIGNIN_INPUT: () => 'x',
				SIGNIN_USER_LOOKUP_FAILED: () => 'x',
				SIGNIN_LINK_FAILED: () => 'x',
				INTERNAL_SERVER_ERROR: () => 'x',
				UNEXPECTED: () => 'x'
			}
		);
		expect(out).toBe('x');
	});
});

describe('verifyMagicLink', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('treats a missing token as expired without calling the API', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(verifyMagicLink('')).resolves.toEqual({
			status: 'expired',
			destination: '/auth/expired'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('verifies the token against better-auth and lands on the app entry', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ token: 't', user: { email: 'jane@example.com' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		await expect(verifyMagicLink('valid-token')).resolves.toEqual({
			status: 'ok',
			destination: '/'
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(String(url)).toBe('/api/auth/magic-link/verify?token=valid-token');
		expect(init.redirect).toBe('manual');
	});

	it('treats a non-ok verification response (stale token redirect) as expired', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302 })));

		await expect(verifyMagicLink('stale')).resolves.toEqual({
			status: 'expired',
			destination: '/auth/expired'
		});
	});

	it('treats a failed request as expired', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

		await expect(verifyMagicLink('token')).resolves.toEqual({
			status: 'expired',
			destination: '/auth/expired'
		});
	});
});
