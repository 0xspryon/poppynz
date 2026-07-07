import type { AuthPanel } from '$lib/auth-panel';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: 'No harm done',
			headline: [
				[{ text: 'Links expire.' }],
				[{ text: "Trust doesn't" }, { text: '.', accent: true }]
			],
			body: "Short-lived links are part of how we keep every family's and helper's account secure.",
			trustLine: 'Single-use links · PIPEDA-compliant · End-to-end encrypted'
		}
	};
}
