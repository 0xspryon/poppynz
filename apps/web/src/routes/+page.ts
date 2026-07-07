import { redirect } from '@sveltejs/kit';

// Until there's a public landing page, the app entry is the auth flow.
export function load(): never {
	redirect(307, '/auth/sign-up');
}
