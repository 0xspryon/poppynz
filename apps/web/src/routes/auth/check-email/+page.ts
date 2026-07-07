import type { AuthPanel } from '$lib/auth-panel';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: 'One tap away',
			headline: [
				[{ text: 'Your link is in' }],
				[{ text: 'the mail' }, { text: '.', accent: true }]
			],
			body: "We never store passwords. Every sign-in link is single-use and expires quickly — that's what keeps your account safe.",
			trustLine: 'Single-use links · PIPEDA-compliant · End-to-end encrypted'
		}
	};
}
