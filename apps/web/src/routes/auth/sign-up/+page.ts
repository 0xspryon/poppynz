import type { AuthPanel } from '$lib/auth-panel';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: 'Welcome to Poppynz',
			headline: [
				[{ text: 'A few minutes now,' }],
				[{ text: 'trusted help ' }, { text: 'after', accent: true }, { text: '.' }]
			],
			body: "Tell us a bit about yourself. We'll connect families with vetted Mom Helpers near them, available when needed.",
			testimonial: {
				quote: '“Our kids ask for Maria by name now. She remembers the granola Theo likes.”',
				attribution: 'Adelaide, mum to Theo (5) · Mississauga',
				initial: 'A'
			},
			trustLine: 'Background-checked helpers · PIPEDA-compliant · End-to-end encrypted',
			aux: { text: 'Already with us?', cta: 'Sign in', href: '/auth/sign-in' },
			mobileHero: true
		}
	};
}
