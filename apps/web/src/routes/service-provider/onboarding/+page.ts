// Magic-link landing for newly signed-up providers (the API's
// newUserCallbackURL) — the hub IS the onboarding, so land on the dashboard.
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = () => {
	redirect(307, resolve('/service-provider/dashboard'));
};
