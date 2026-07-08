import type { AuthPanel } from '$lib/auth-panel';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			headline: [[{ text: 'Welcome' }], [{ text: 'back' }, { text: '.', accent: true }]],
			body: 'Verifying your secure link and getting your account ready.'
		}
	};
}
