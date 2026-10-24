import type { AuthPanel } from '$lib/auth-panel';
import { m } from '$lib/paraglide/messages';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: m.auth_panel_signin_eyebrow(),
			headline: [
				[{ text: m.auth_panel_signin_line1() }],
				[{ text: m.auth_panel_signin_line2() }, { text: '.', accent: true }]
			],
			body: m.auth_panel_signin_body(),
			trustLine: m.auth_panel_trust_line(),
			aux: {
				text: m.auth_panel_signin_aux_text(),
				cta: m.auth_panel_signin_aux_cta(),
				href: '/auth/sign-up'
			},
			mobileHero: true
		}
	};
}
