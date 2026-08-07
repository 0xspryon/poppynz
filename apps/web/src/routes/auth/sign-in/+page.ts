import type { AuthPanel } from '$lib/auth-panel';

export function load(): { panel: AuthPanel } {
	return {
		panel: {
			eyebrow: 'Welcome back',
			headline: [[{ text: 'Good to see' }], [{ text: 'you again' }, { text: '.', accent: true }]],
			body: "Enter your email and we'll send you a secure sign-in link. No password to remember.",
			trustLine: 'Single-use links · PIPEDA-compliant · End-to-end encrypted',
			aux: { text: 'New to Poppynz?', cta: 'Create account', href: '/auth/sign-up' },
			mobileHero: true
		}
	};
}
