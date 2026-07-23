import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// better-auth's errorCallbackURL lands here (e.g. ?error=INVALID_TOKEN when a
// magic link is stale). The expired page owns the recovery UI; the error code
// is forwarded so it can adapt its copy.
export function load({ url }: { url: URL }) {
	const error = url.searchParams.get('error');
	redirect(
		307,
		error
			? `${resolve('/auth/expired')}?error=${encodeURIComponent(error)}`
			: resolve('/auth/expired')
	);
}
