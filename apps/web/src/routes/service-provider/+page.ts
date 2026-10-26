import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getSession } from '$lib/api/profile';
import { resolveLanding } from '$lib/role-landing';

// The role home reads the member's contracts (UAT round 2 #5), which only the
// browser's session can do.
export const ssr = false;

export const load = async () => {
	const usual = resolve('/service-provider/dashboard');
	const target =
		getSession()?.role === 'service-provider'
			? await resolveLanding('service-provider', usual)
			: usual;
	redirect(307, target ?? usual);
};
