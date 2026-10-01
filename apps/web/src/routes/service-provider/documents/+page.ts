// Merged into Verification; kept as a redirect for emailed and bookmarked
// links. The fragment scrolls to the matching section.
import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = () => {
	redirect(307, `${resolve('/service-provider/verification')}#identity`);
};
