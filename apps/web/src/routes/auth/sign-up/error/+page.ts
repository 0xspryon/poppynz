import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// better-auth's errorCallbackURL lands here (e.g. ?error=INVALID_TOKEN when a
// magic link is stale). The expired page owns the recovery UI.
export function load() {
	redirect(307, resolve('/auth/expired'));
}
