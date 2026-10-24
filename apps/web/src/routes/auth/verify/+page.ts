import type { AuthPanel } from '$lib/auth-panel';
import { m } from '$lib/paraglide/messages';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			headline: [
				[{ text: m.auth_panel_verify_line1() }],
				[{ text: m.auth_panel_verify_line2() }, { text: '.', accent: true }]
			],
			body: m.auth_panel_verify_body()
		}
	};
}
