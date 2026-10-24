import type { AuthPanel } from '$lib/auth-panel';
import { m } from '$lib/paraglide/messages';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: m.auth_panel_signup_eyebrow(),
			// The accent word is styled on its own, so the line is split around it.
			headline: [
				[{ text: m.auth_panel_signup_line1() }],
				[
					{ text: m.auth_panel_signup_line2_before() },
					{ text: m.auth_panel_signup_line2_accent(), accent: true },
					{ text: '.' }
				]
			],
			body: m.auth_panel_signup_body(),
			testimonial: {
				quote: m.auth_panel_signup_quote(),
				attribution: m.auth_panel_signup_attribution(),
				initial: 'A'
			},
			trustLine: m.auth_panel_signup_trust_line(),
			aux: {
				text: m.auth_panel_signup_aux_text(),
				cta: m.auth_panel_signup_aux_cta(),
				href: '/auth/sign-in'
			},
			mobileHero: true
		}
	};
}
