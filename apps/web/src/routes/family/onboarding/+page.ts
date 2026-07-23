// Magic-link landing for newly signed-up families (the API's
// newUserCallbackURL) — their home is the profile page for now.
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = () => {
	redirect(307, resolve('/family/profile'));
};
