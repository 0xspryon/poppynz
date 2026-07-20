import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export function load({ url }: { url: URL }) {
	// Keep the query string — dev uses /admin?as=admin to bootstrap a session.
	redirect(307, resolve('/admin/document-types') + url.search);
}
