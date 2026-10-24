import type { AuthPanel } from '$lib/auth-panel';
import { m } from '$lib/paraglide/messages';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: m.auth_panel_check_email_eyebrow(),
			headline: [
				[{ text: m.auth_panel_check_email_line1() }],
				[{ text: m.auth_panel_check_email_line2() }, { text: '.', accent: true }]
			],
			body: m.auth_panel_check_email_body(),
			trustLine: m.auth_panel_trust_line()
		}
	};
}
